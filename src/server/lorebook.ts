import { parseKeys } from '../shared/ids.ts';
import { estimateTokens } from '../shared/tokens.ts';
import type { LoreEntry, LoreHit, LorePosition } from '../shared/types.ts';

/**
 * Lorebook resolution.
 *
 * Two things matter here beyond "does the keyword appear":
 *
 * 1. **Determinism.** The scan window is anchored to the *transcript boundary*,
 *    not to the newest turn's text alone. If new user text alone drove the scan,
 *    the set of injected entries would change on almost every turn, and every
 *    change to the lore blocks invalidates that block and all later ones in the
 *    cache prefix. Scanning the tail of the transcript instead means the same
 *    entries fire for as long as the scene keeps talking about them.
 *
 * 2. **Budget discipline.** Lore is the one part of the payload that can quietly
 *    balloon. Entries are ranked, then packed greedily against a token budget, so
 *    the cache-stable prefix has a fixed ceiling.
 */

/** How many trailing messages form the keyword scan window. */
const SCAN_DEPTH = 6;

export type LoreResolutionInput = {
  entries: readonly LoreEntry[];
  /** Recent transcript text, oldest first. */
  recent: readonly string[];
  /** The turn's own prompt, which should be able to trigger entries too. */
  immediate: readonly string[];
  /** Tokens available for all injected lore. */
  budget: number;
};

export type LoreResolution = {
  hits: LoreHit[];
  usedTokens: number;
  /** Entries that matched but lost the budget race. */
  skipped: { title: string; tokens: number; reason: string }[];
};

function scoreEntry(entry: LoreEntry, haystack: string, keys: readonly string[]): number {
  let matched = 0;
  let weight = 0;
  for (const key of keys) {
    if (!haystack.includes(key)) continue;
    matched += 1;
    // Longer keys are more specific — "Hollow Court" should outrank "court".
    weight += key.includes(' ') ? 2.5 : 1;
  }
  if (matched === 0) return 0;
  // Later, more specific entries win; `priority` breaks ties deterministically.
  return weight * entry.weight * 10 + matched * 2 - entry.priority / 1000;
}

export function resolveLore(input: LoreResolutionInput): LoreResolution {
  const haystack = [...input.recent, ...input.immediate].join('\n').toLowerCase();

  type Candidate = { entry: LoreEntry; score: number; reason: string };
  const candidates: Candidate[] = [];

  for (const entry of input.entries) {
    if (!entry.enabled || !entry.body.trim()) continue;

    if (entry.constant) {
      candidates.push({ entry, score: 1e6 - entry.priority / 1000, reason: 'constant' });
      continue;
    }

    const keys = parseKeys(entry.keys);
    if (keys.length === 0) continue;

    const score = scoreEntry(entry, haystack, keys);
    if (score > 0) candidates.push({ entry, score, reason: 'key' });
  }

  // Constants first, then by score. Stable sort keeps ties in insertion order,
  // which is `position, priority, created_at` from the DAO.
  candidates.sort((a, b) => b.score - a.score);

  const hits: LoreHit[] = [];
  const skipped: { title: string; tokens: number; reason: string }[] = [];
  let usedTokens = 0;

  for (const candidate of candidates) {
    const cost = candidate.entry.tokens || estimateTokens(candidate.entry.body);
    if (usedTokens + cost > input.budget) {
      skipped.push({
        title: candidate.entry.title,
        tokens: cost,
        reason: candidate.entry.constant ? 'constant entry over budget' : 'budget exhausted',
      });
      continue;
    }
    usedTokens += cost;
    hits.push({
      entryId: candidate.entry.id,
      title: candidate.entry.title,
      body: candidate.entry.body,
      position: candidate.entry.position,
      depth: candidate.entry.depth,
      tokens: cost,
      reason: candidate.reason,
      score: candidate.score,
    });
  }

  return { hits, usedTokens, skipped };
}

/** Group resolved hits by injection position, preserving rank order. */
export function groupByPosition(hits: readonly LoreHit[]): Record<LorePosition, LoreHit[]> {
  const groups: Record<LorePosition, LoreHit[]> = {
    anchor: [],
    depth: [],
    before: [],
    after: [],
  };
  for (const hit of hits) groups[hit.position].push(hit);
  return groups;
}

export function renderLore(hits: readonly LoreHit[], heading: string): string {
  if (hits.length === 0) return '';
  const body = hits.map((hit) => `### ${hit.title}\n${hit.body.trim()}`).join('\n\n');
  return heading ? `${heading}\n\n${body}` : body;
}

/** Longest terms from a block of text — cheap, local query terms for BM25 recall. */
export function extractTerms(text: string, limit = 24): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const words = text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];

  // Prefer the longest words: they carry the most signal and match least often.
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length);
  for (const word of unique) {
    if (termStopWords.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= limit) break;
  }
  return terms;
}

/** Deliberately short: only words that would match half the archive. */
const termStopWords = new Set([
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'them', 'their', 'there',
  'what', 'when', 'where', 'which', 'while', 'would', 'could', 'should', 'about', 'into',
  'then', 'than', 'over', 'under', 'just', 'like', 'back', 'still', 'even', 'because',
  'something', 'anything', 'nothing', 'before', 'after', 'again', 'other', 'these', 'those',
  'your', 'yours', 'mine', 'says', 'said', 'going', 'really', 'never', 'always', 'every',
]);

/** Messages whose text feeds the keyword scan, oldest first. */
export function scanWindow(texts: readonly string[], depth = SCAN_DEPTH): string[] {
  return texts.slice(-depth);
}

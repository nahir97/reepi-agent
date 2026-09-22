/**
 * Agent Note gate.
 *
 * The notes corpus is only worth keeping if it stays consistent, and consistency
 * is exactly what humans (and agents) forget. This checks the structural rules
 * from `.agents/notes/README.md` — the ones a machine can decide — and leaves the
 * judgement calls (is this note still useful? does that alternative hold up?)
 * where they belong, with a reader.
 *
 * Deliberately not checked: whether a note is *good*, whether an implemented note
 * still earns its place, or whether two notes overlap. Those need judgement, and
 * a gate that guessed at them would be suppressed within a week.
 *
 *   npm run verify:notes
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, posix, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const NOTES = join(ROOT, '.agents/notes');

/**
 * Prose outside the corpus that points into it. `AGENTS.md` is where every agent starts,
 * so a broken link there sends a reader nowhere before they have read anything else.
 */
const EXTERNAL_DOCS = ['AGENTS.md', 'README.md'] as const;

/** The closed lifecycle set. A new folder here is a new lifecycle, not a new class. */
const LIFECYCLES = ['proposed', 'implemented', 'rejected', 'archived'] as const;
type Lifecycle = (typeof LIFECYCLES)[number];

/** The closed class set. Adding one is a documented decision, not a folder. */
const CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'] as const;

/** Sections required per lifecycle, in the order the README states them. */
const REQUIRED: Record<Lifecycle, string[]> = {
  proposed: ['## Problem', '## Proposal', '## Alternatives considered', '## Acceptance criteria', '## Risks'],
  implemented: ['## Problem', '## Decision', '## Alternatives considered', '## Consequences'],
  // A rejected note keeps its proposal-time shape; only the opener is mandated.
  rejected: ['## Problem'],
  // Archived notes are frozen snapshots of the format they had when sealed.
  archived: ['## Problem'],
};

/**
 * Headings that mean "this has not shipped". An implemented note must not carry
 * them — shipping removes the plan, and leaving it in place is how a note starts
 * describing an intention instead of a reality.
 */
const PROPOSAL_ERA_HEADINGS = ['## Proposal', '## Plan', '## Migration plan', '## Acceptance criteria'];

/** The escape hatch for notes that predate the alternatives requirement. */
const PRE_FORMAT_MARKER = '<!-- agent-notes: alternatives-not-recorded (pre-format note) -->';

const FILENAME = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

type Problem = { file: string; message: string };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // `assets/` holds images a note may reference; it is not part of the tree.
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith('.md')) {
      // The spec and any other root-level prose are documentation, not notes.
      if (dir === NOTES) continue;
      out.push(full);
    }
  }
  return out;
}

function headingPositions(body: string): { heading: string; index: number }[] {
  const found: { heading: string; index: number }[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    if (line.startsWith('## ')) found.push({ heading: line.trimEnd(), index: found.length });
  }
  return found;
}

function checkNote(path: string): Problem[] {
  const rel = posix.join('.agents/notes', relative(NOTES, path).split(/[\\/]/).join('/'));
  const text = readFileSync(path, 'utf8');
  const problems: Problem[] = [];
  const add = (message: string): void => void problems.push({ file: rel, message });

  const segments = relative(NOTES, path).split(/[\\/]/);
  const lifecycle = segments[0] as Lifecycle;
  const klass = segments[1];

  if (!LIFECYCLES.includes(lifecycle)) {
    add(`unknown lifecycle folder "${lifecycle}" (expected one of ${LIFECYCLES.join(', ')})`);
    return problems;
  }
  if (!klass || !CLASSES.includes(klass as (typeof CLASSES)[number])) {
    add(`unknown class folder "${klass ?? '(none)'}" (expected one of ${CLASSES.join(', ')})`);
  }
  if (segments.length !== 3) {
    add(`expected exactly {lifecycle}/{class}/file.md, got ${segments.length} levels`);
  }

  const base = segments[segments.length - 1] ?? '';
  if (!FILENAME.test(base)) {
    add(
      base.includes('.md')
        ? `filename "${base}" must be yyyy-mm-dd-topic-slug.md (lowercase, hyphenated, no spaces)`
        : `filename "${base}" must end in .md`,
    );
  }

  /* ---- header block ---------------------------------------------------- */

  const lines = text.split('\n');
  if (!lines[0]?.startsWith('# Agent Note: ')) {
    add(`line 1 must be "# Agent Note: <title>", got ${JSON.stringify(lines[0] ?? '')}`);
  } else if (!lines[0].slice('# Agent Note: '.length).trim()) {
    add('the title after "# Agent Note: " is empty');
  }
  if (lines[1]?.trim() !== '') add('line 2 must be blank');
  if (!lines[2]?.startsWith('Status: ')) {
    add(`line 3 must be "Status: <status>", got ${JSON.stringify(lines[2] ?? '')}`);
  }

  const status = lines[2]?.slice('Status: '.length).trim() ?? '';
  const statusLifecycle: Record<string, Lifecycle> = {
    proposed: 'proposed',
    implemented: 'implemented',
    archived: 'archived',
  };
  if (status.startsWith('rejected')) {
    // A rejection's verdict is the fact readers come for, so the reason is required.
    if (!/^rejected\s+—\s+\S/.test(status)) {
      add('a rejected note needs "Status: rejected — <why, in one line>"');
    }
    if (lifecycle !== 'rejected') add(`status says rejected but the folder is ${lifecycle}/`);
  } else if (statusLifecycle[status] !== undefined) {
    if (statusLifecycle[status] !== lifecycle) {
      add(`status "${status}" does not match the ${lifecycle}/ folder`);
    }
  } else if (status) {
    add(`unknown status "${status}" (expected proposed, implemented, or "rejected — reason")`);
  }

  if (lifecycle === 'archived' && !/^Archived: \d{4}-\d{2}-\d{2}$/m.test(text)) {
    add('an archived note needs an "Archived: YYYY-MM-DD" line');
  }

  /* ---- body ------------------------------------------------------------ */

  const body = lines.slice(3).join('\n');
  const headings = headingPositions(body).map((h) => h.heading);

  for (const required of REQUIRED[lifecycle]) {
    if (!headings.includes(required)) add(`missing required section "${required}"`);
  }

  if (lifecycle === 'implemented') {
    for (const forbidden of PROPOSAL_ERA_HEADINGS) {
      if (headings.includes(forbidden)) {
        add(`implemented notes must not carry "${forbidden}" — shipping removes the plan`);
      }
    }
  }

  /* ---- alternatives ---------------------------------------------------- */

  const hasAlternatives = headings.includes('## Alternatives considered');
  if (!hasAlternatives && !text.includes(PRE_FORMAT_MARKER)) {
    add(
      'missing "## Alternatives considered" (a decision recorded without what it beat invites being undone). ' +
        'Pre-format notes may use the exact alternatives-not-recorded comment instead.',
    );
  } else if (hasAlternatives) {
    const start = body.indexOf('## Alternatives considered');
    const rest = body.slice(start + '## Alternatives considered'.length);
    const nextHeading = rest.search(/^## /m);
    const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
    if (section.length < 40) {
      add('"## Alternatives considered" is effectively empty — name each alternative and why it lost');
    }
  }

  /* ---- links ----------------------------------------------------------- */

  problems.push(...checkLinks(path, rel, text));
  return problems;
}

/**
 * Every relative markdown link must resolve.
 *
 * Applied to the spec documents as well as the notes: a link from the corpus into a
 * skill, or from the README into a note, is exactly the kind of cross-reference that
 * rots silently when something moves.
 */
function checkLinks(path: string, rel: string, text: string): Problem[] {
  const problems: Problem[] = [];
  for (const match of text.matchAll(/\]\((\.{0,2}\/?[^):#]+\.md)(?:#[^)]*)?\)/g)) {
    try {
      statSync(resolve(path, '..', match[1] as string));
    } catch {
      problems.push({ file: rel, message: `broken link to ${match[1]}` });
    }
  }
  return problems;
}

const files = walk(NOTES);
const problems = files.flatMap(checkNote);

/**
 * Root-level prose (the spec itself) is not a note and carries no header block, but its
 * links must still resolve — this is where the corpus points at its own skill.
 */
for (const entry of readdirSync(NOTES, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
  const full = join(NOTES, entry.name);
  problems.push(...checkLinks(full, `.agents/notes/${entry.name}`, readFileSync(full, 'utf8')));
}

/* And the entry-point docs, whose links are the first a reader follows. */
for (const doc of EXTERNAL_DOCS) {
  const full = join(ROOT, doc);
  if (!existsSync(full)) continue;
  problems.push(...checkLinks(full, doc, readFileSync(full, 'utf8')));
}

/**
 * A skill named in prose must exist. Only checked where a skill is referenced by path or
 * by name in the entry-point docs — a roster would be the index this format rejects, so
 * this catches a rename without requiring an inventory.
 */
const KNOWN_SKILLS = readdirSync(join(ROOT, '.agents/skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
for (const doc of [...EXTERNAL_DOCS, '.agents/notes/README.md']) {
  const full = join(ROOT, doc);
  if (!existsSync(full)) continue;
  // A skill may be named in backticks or as the label of a link to it; both rot the
  // same way when it is renamed.
  for (const match of readFileSync(full, 'utf8').matchAll(/(?:`|\[)(reepi-[a-z-]+)(?:`|\s|\)|\])/g)) {
    if (!KNOWN_SKILLS.includes(match[1] as string)) {
      problems.push({ file: doc, message: `references skill "${match[1]}" which does not exist` });
    }
  }
}

/* Cross-note duplicate detection: one decision should have one owner, and the
 * most common cause of divergence is two notes with the same title. */
const byTitle = new Map<string, string[]>();
for (const file of files) {
  const first = readFileSync(file, 'utf8').split('\n')[0] ?? '';
  const title = first.replace(/^# Agent Note:\s*/, '').trim().toLowerCase();
  if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), relative(NOTES, file)]);
}
for (const [title, where] of byTitle) {
  if (where.length > 1) {
    problems.push({ file: where.join(', '), message: `duplicate note title "${title}"` });
  }
}

const counts = new Map<string, number>();
for (const file of files) {
  const seg = relative(NOTES, file).split(/[\\/]/);
  const key = `${seg[0]}/${seg[1]}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

console.log(`Agent Notes: ${files.length} across ${counts.size} lifecycle/class folders`);
for (const [key, n] of [...counts].sort()) console.log(`  ${String(n).padStart(4)}  ${key}/`);

if (problems.length === 0) {
  console.log('\nAll notes conform.');
  process.exit(0);
}

console.log(`\n${problems.length} problem(s):\n`);
for (const p of problems) console.log(`  ${p.file}\n    ${p.message}`);
process.exitCode = 1;

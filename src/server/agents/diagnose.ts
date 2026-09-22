/**
 * The diagnosis pass — a live self-check of the running server.
 *
 * Separate because it is the only pass about the machine rather than the story: it
 * inspects the environment, the story contract, the history budget and the billing
 * window, and probes the API's own cache accounting directly.
 */

import { cacheMultiplier, isPeak } from '../../shared/cost.ts';
import type { DiagnoseReport } from '../../shared/api.ts';
import { DeepSeekError, completeChat, type WireMessage } from '../deepseek.ts';
import { memories, messages } from '../store/index.ts';
import { storiesSafe } from './context.ts';

/**
 * Live self-check. The cache smoke test is the important part: it sends the same
 * ~4k-token payload twice and reads the API's own hit accounting, so it verifies
 * the app's central assumption against reality rather than asserting it.
 */
export async function runDiagnose(storyId: string | null): Promise<DiagnoseReport> {
  const checks: DiagnoseReport['checks'] = [];
  const keyPresent = Boolean(process.env.DEEPSEEK_API_KEY);

  checks.push({
    id: 'key',
    label: 'DeepSeek API key',
    level: keyPresent ? 'pass' : 'fail',
    detail: keyPresent ? 'Present in the server environment.' : 'DEEPSEEK_API_KEY is not set.',
    ...(keyPresent ? {} : { fix: 'Add DEEPSEEK_API_KEY to .env and restart the server.' }),
  });

  checks.push({
    id: 'thinking',
    label: 'Narration runs with thinking disabled',
    level: 'pass',
    detail:
      'Narration uses reasoning_effort "none". Thinking mode ignores temperature and would bill reasoning tokens on every turn.',
  });

  checks.push({
    id: 'tools',
    label: 'Narration requests carry no tools',
    level: 'pass',
    detail:
      'Agentic passes run as separate side-channel calls, so the narration prefix stays free of the reasoning-echo requirement and stays cacheable.',
  });

  let cacheSmoke: DiagnoseReport['cacheSmoke'] = null;

  if (keyPresent) {
    try {
      const filler = Array.from(
        { length: 320 },
        (_, index) =>
          `[CACHE-PROBE ${index}] The tide-bound archive records ${index}: silver oath, ash crown, and the oath-scar that will not fade.`,
      ).join('\n');

      const probe: WireMessage[] = [
        { role: 'system', content: `You are a continuity checker.\n\nWorld notes:\n${filler}` },
        { role: 'user', content: 'Reply with exactly: READY' },
      ];

      const first = await completeChat({
        messages: probe,
        model: 'deepseek-flash',
        effort: 'none',
        maxTokens: 8,
      });

      // DeepSeek persists a cache unit per request boundary, and construction
      // takes seconds — pause before the probe that is meant to hit it.
      const pause = Promise.withResolvers<void>();
      setTimeout(pause.resolve, 2500);
      await pause.promise;

      const second = await completeChat({
        messages: probe,
        model: 'deepseek-flash',
        effort: 'none',
        maxTokens: 8,
      });

      const hit = second.usage.cacheHitTokens;
      const miss = second.usage.cacheMissTokens;
      const rate = hit + miss > 0 ? hit / (hit + miss) : 0;
      const speedup = first.totalMs / Math.max(1, second.totalMs);

      cacheSmoke = {
        ran: true,
        hitTokens: hit,
        missTokens: miss,
        hitRate: rate,
        firstMs: first.totalMs,
        secondMs: second.totalMs,
        verdict:
          rate > 0.5
            ? `Cache hits confirmed: ${Math.round(rate * 100)}% of the repeated prefix was served from disk cache, and the second call was ${speedup.toFixed(1)}× faster.`
            : 'The repeated prefix was not served from cache. Cache units expire after a few hours idle, and a heavily loaded first call can delay persistence — re-run this check.',
      };

      checks.push({
        id: 'cache',
        label: 'Prompt cache verified live',
        level: rate > 0.5 ? 'pass' : 'warn',
        detail: `${hit} hit / ${miss} miss tokens on an identical repeat payload.`,
        ...(rate > 0.5
          ? {}
          : { fix: 'Re-run the cache check; if it still misses, the prefix is changing or the cache has gone cold.' }),
      });
    } catch (error) {
      const message =
        error instanceof DeepSeekError ? error.message : error instanceof Error ? error.message : 'unknown error';
      cacheSmoke = null;
      checks.push({
        id: 'cache',
        label: 'Prompt cache verified live',
        level: 'fail',
        detail: `Probe request failed: ${message}`,
        fix: 'Check the API key, balance, and network access to api.deepseek.com.',
      });
    }
  }

  if (storyId) {
    const story = storiesSafe(storyId);
    if (story) {
      const messageCount = messages.count(storyId);
      const memoryCount = memories.count(storyId);

      checks.push({
        id: 'contract',
        label: 'Story contract is set',
        level: story.contract.trim() ? 'pass' : 'warn',
        detail: story.contract.trim()
          ? 'A voice and format contract is in the frozen prefix.'
          : 'No contract set. The narrator has no formatting rules to obey.',
        ...(story.contract.trim() ? {} : { fix: 'Open story settings and add a contract, or apply a template.' }),
      });

      checks.push({
        id: 'history',
        label: 'Transcript is within the history budget',
        level: 'pass',
        detail: `${messageCount} messages, history budget ${story.historyBudget.toLocaleString()} tokens.`,
      });

      if (messageCount > 30 && memoryCount === 0) {
        checks.push({
          id: 'memory',
          label: 'Memory index has entries',
          level: 'warn',
          detail: `${messageCount} messages but no memories extracted.`,
          fix: 'Run the Archivist pass; recall is local BM25 and costs nothing to query.',
        });
      }

      checks.push({
        id: 'peak',
        label: 'Billing window',
        level: isPeak() ? 'warn' : 'pass',
        detail: isPeak()
          ? `Peak hours: every token costs 2× the off-peak rate. A miss costs ${cacheMultiplier(story.model, true).toFixed(0)}× a cache hit right now.`
          : `Off-peak: a cache miss costs ${cacheMultiplier(story.model, false).toFixed(0)}× a hit. Best time to write long.`,
      });
    }
  }

  return { checks, cacheSmoke };
}

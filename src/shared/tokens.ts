/**
 * Token estimation.
 *
 * We do not ship DeepSeek's BPE vocab, so the estimator is heuristic — but it is
 * *self-calibrating*: every API response reports the true `prompt_tokens`, so the
 * server folds the observed ratio back into an EWMA factor. Within a handful of
 * turns the previews track reality closely, which matters because the whole app
 * is a cost instrument.
 */

/** Per-message overhead DeepSeek adds when wrapping `{role, content}`. */
const MESSAGE_OVERHEAD = 4;

/** Per-tool JSON-schema overhead. */
const TOOL_OVERHEAD = 12;

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const WORDISH = /[A-Za-z\u00c0-\u024f]/;

/**
 * Raw, uncalibrated estimate. Blends three rules of thumb that hold up on mixed
 * prose: English runs about 4 characters per token, CJK about 1.6 characters per
 * token, and each run of non-word symbols collapses into roughly one token.
 */
export function rawEstimate(text: string): number {
  if (!text) return 0;

  let cjk = 0;
  let wordChars = 0;
  let digitRuns = 0;
  let symbolRuns = 0;
  let inSymbol = false;
  let inDigit = false;

  for (const char of text) {
    if (CJK.test(char)) {
      cjk += 1;
      inSymbol = false;
      inDigit = false;
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code <= 0x20) {
      inSymbol = false;
      inDigit = false;
      continue;
    }
    if (char >= '0' && char <= '9') {
      if (!inDigit) digitRuns += 1;
      inDigit = true;
      inSymbol = false;
      continue;
    }
    inDigit = false;
    if (WORDISH.test(char)) {
      wordChars += 1;
      inSymbol = false;
      continue;
    }
    if (!inSymbol) symbolRuns += 1;
    inSymbol = true;
  }

  return cjk * 0.62 + wordChars / 4.05 + digitRuns * 0.9 + symbolRuns * 0.55;
}

/**
 * Calibration factor. Starts at 1 and is nudged toward the observed
 * `actual / raw` ratio after every API response.
 */
export type Calibration = { factor: number; samples: number; updatedAt: number };

export const DEFAULT_CALIBRATION: Calibration = { factor: 1, samples: 0, updatedAt: 0 };

const FACTOR_MIN = 0.55;
const FACTOR_MAX = 1.8;

/**
 * Fold a fresh observation into the calibration. Uses a larger learning rate for
 * the first few samples so the estimate converges fast, then settles to 0.08.
 */
export function calibrate(prev: Calibration, raw: number, actual: number): Calibration {
  if (raw < 40 || actual <= 0) return prev;
  const observed = actual / raw;
  // Guard against pathological single samples.
  if (observed < 0.35 || observed > 3) return prev;
  const lr = prev.samples < 5 ? 0.4 : 0.08;
  const factor = prev.factor * (1 - lr) + observed * lr;
  return {
    factor: Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, factor)),
    samples: prev.samples + 1,
    updatedAt: Date.now(),
  };
}

/** Estimate a single string with calibration applied. */
export function estimateTokens(text: string, cal: Calibration = DEFAULT_CALIBRATION): number {
  return Math.max(0, Math.round(rawEstimate(text) * cal.factor));
}

export type WireMessage = { role: string; content: string | null };

/** Estimate a full message array, including per-message framing overhead. */
export function estimateMessages(
  messages: readonly WireMessage[],
  cal: Calibration = DEFAULT_CALIBRATION,
): number {
  let total = 0;
  for (const message of messages) {
    total += MESSAGE_OVERHEAD;
    if (message.content) total += estimateTokens(message.content, cal);
  }
  return total;
}

/** Estimate tool JSON-schema overhead for a request that carries tools. */

/** Rough word count, used for the length governor. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

/** Characters, including spaces — the unit writers actually think in. */

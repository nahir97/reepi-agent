import type { ModelId, ReasoningEffort } from '../shared/types.ts';

/**
 * DeepSeek Chat Completions client.
 *
 * Design notes that matter for cost:
 *
 * 1. **Thinking is on by default** on V4.1 Flash at effort `high`, and thinking
 *    mode *silently ignores* `temperature`, `presence_penalty` and
 *    `frequency_penalty`. Roleplay needs temperature, so the narrator runs with
 *    `reasoning_effort: "none"` (the only value that disables thinking).
 *
 * 2. **Reasoning echoes.** When a request carries `tools`, the API requires every
 *    prior assistant message's `reasoning_content` to be sent back, or it 400s.
 *    We keep that round-trip off the narration path entirely (`includeTools`
 *    defaults to false) because echoed reasoning is billed as input on every
 *    subsequent turn and cannot be cached away.
 *
 * 3. **Cache accounting.** Both `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`
 *    and the nested `prompt_tokens_details.cached_tokens` are read, since the two
 *    have drifted between model generations.
 */

const DEFAULT_BASE = 'https://api.deepseek.com';
const BETA_BASE = 'https://api.deepseek.com/beta';

export type WireTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type WireToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type WireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Required by the API whenever any request in the thread carries `tools`. */
  reasoning_content?: string;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  /** Chat Prefix Completion (beta base URL only). */
  prefix?: boolean;
};

export type ChatUsage = {
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type ChatResult = {
  text: string;
  reasoning: string;
  toolCalls: WireToolCall[];
  usage: ChatUsage;
  finishReason: string | null;
  ttftMs: number | null;
  totalMs: number;
  attempts: number;
};

export type StreamHandlers = {
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
};

export type ChatParams = {
  messages: WireMessage[];
  model?: ModelId;
  effort?: ReasoningEffort;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  tools?: WireTool[];
  jsonMode?: boolean;
  /** Route through the beta base URL and honour `prefix: true`. */
  prefixCompletion?: boolean;
  stream?: boolean;
  signal?: AbortSignal;
};

export class DeepSeekError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
    this.retryable = status === 429 || status === 408 || status >= 500;
  }
}

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new DeepSeekError('DEEPSEEK_API_KEY is not set. Add it to .env and restart.', 0);
  }
  return key;
}

function baseUrl(beta: boolean): string {
  return process.env.DEEPSEEK_BASE_URL ?? (beta ? BETA_BASE : DEFAULT_BASE);
}

function buildBody(params: ChatParams, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model ?? 'deepseek-flash',
    messages: params.messages,
    max_tokens: params.maxTokens ?? 1024,
    reasoning_effort: params.effort ?? 'none',
    stream,
  };

  // Thinking mode ignores these outright; sending them would only add noise.
  if ((params.effort ?? 'none') === 'none') {
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
  } else if (params.topP !== undefined) {
    // In thinking mode top_p is honoured but clamped to 0.95–1.0.
    body.top_p = Math.min(1, Math.max(0.95, params.topP));
  }

  if (params.stop?.length) body.stop = params.stop;
  if (params.tools?.length) body.tools = params.tools;
  if (params.jsonMode) body.response_format = { type: 'json_object' };
  if (stream) body.stream_options = { include_usage: true };

  return body;
}

function readUsage(raw: unknown): ChatUsage {
  const usage = (raw ?? {}) as Record<string, unknown>;
  const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completion = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;

  const hit = Number(usage.prompt_cache_hit_tokens ?? details.cached_tokens ?? 0) || 0;
  const promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
  const miss = Number(usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - hit)) || 0;

  return {
    promptTokens: promptTokens || hit + miss,
    cacheHitTokens: hit,
    cacheMissTokens: miss,
    outputTokens: Number(usage.completion_tokens ?? 0) || 0,
    reasoningTokens: Number(completion.reasoning_tokens ?? 0) || 0,
  };
}

const EMPTY_USAGE: ChatUsage = {
  promptTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

async function post(params: ChatParams, stream: boolean): Promise<Response> {
  const beta = Boolean(params.prefixCompletion);
  const response = await fetch(`${baseUrl(beta)}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey()}`,
      accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(buildBody(params, stream)),
    signal: params.signal,
  });
  return response;
}

async function raiseFor(response: Response): Promise<never> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    detail = body.error?.message ?? body.message ?? detail;
  } catch {
    /* body was not JSON; the status line is all we have. */
  }
  throw new DeepSeekError(detail, response.status);
}

/** Exponential backoff with jitter; only used before anything has streamed. */
async function sleep(attempt: number, signal?: AbortSignal): Promise<void> {
  const base = Math.min(8000, 400 * 2 ** (attempt - 1));
  const delay = base / 2 + Math.random() * (base / 2);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, delay);
  function onAbort() {
    clearTimeout(timer);
    reject(signal?.reason ?? new Error('aborted'));
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  return promise;
}

const MAX_ATTEMPTS = 3;

/**
 * Streaming chat completion. `onText`/`onReasoning` fire as deltas arrive; the
 * resolved value always carries the full text plus real usage numbers.
 */
export async function streamChat(
  params: ChatParams,
  handlers: StreamHandlers = {},
): Promise<ChatResult> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const started = Date.now();
    let ttftMs: number | null = null;
    let text = '';
    let reasoning = '';
    let usage: ChatUsage = EMPTY_USAGE;
    let finishReason: string | null = null;
    const toolCalls: WireToolCall[] = [];

    try {
      const response = await post(params, true);
      if (!response.ok) await raiseFor(response);
      if (!response.body) throw new DeepSeekError('Empty response body', response.status);

      const decoder = new TextDecoder();
      let buffer = '';

      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');

          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue; // skips `: keep-alive` comments
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              continue; // a torn frame; the next boundary will re-sync
            }

            if (event.usage) usage = readUsage(event.usage);

            const choice = (event.choices as Record<string, unknown>[] | undefined)?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = String(choice.finish_reason);

            const delta = (choice.delta ?? {}) as Record<string, unknown>;
            const content = typeof delta.content === 'string' ? delta.content : '';
            const thoughts =
              typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';

            if (content || thoughts) {
              if (ttftMs === null) ttftMs = Date.now() - started;
              if (content) {
                text += content;
                handlers.onText?.(content);
              }
              if (thoughts) {
                reasoning += thoughts;
                handlers.onReasoning?.(thoughts);
              }
            }

            const calls = delta.tool_calls as
              | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
              | undefined;
            if (calls) {
              for (const call of calls) {
                const index = call.index ?? toolCalls.length;
                const slot = (toolCalls[index] ??= {
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                });
                if (call.id) slot.id = call.id;
                if (call.function?.name) slot.function.name += call.function.name;
                if (call.function?.arguments) slot.function.arguments += call.function.arguments;
              }
            }
          }
        }
      }

      return {
        text,
        reasoning,
        toolCalls: toolCalls.filter((call) => call.function.name),
        usage,
        finishReason,
        ttftMs,
        totalMs: Date.now() - started,
        attempts: attempt,
      };
    } catch (error) {
      const aborted =
        params.signal?.aborted === true ||
        (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      if (aborted) {
        return {
          text,
          reasoning,
          toolCalls,
          usage,
          finishReason,
          ttftMs,
          totalMs: Date.now() - started,
          attempts: attempt,
        };
      }
      const retryable = error instanceof DeepSeekError ? error.retryable : true;
      // Never replay a request that already emitted tokens: the caller has
      // already shown them to the user.
      if (!retryable || attempt >= MAX_ATTEMPTS || text.length > 0 || reasoning.length > 0) {
        throw error;
      }
      await sleep(attempt, params.signal);
    }
  }
}

/**
 * Non-streaming completion. Used by the agentic passes (archivist, judge) where
 * latency does not matter and a plain parsed object is easier to consume.
 */
export async function completeChat(params: ChatParams): Promise<ChatResult> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const started = Date.now();
    try {
      const response = await post(params, false);
      if (!response.ok) await raiseFor(response);

      const payload = (await response.json()) as {
        choices?: {
          message?: Record<string, unknown>;
          finish_reason?: string;
        }[];
        usage?: unknown;
      };

      const message = payload.choices?.[0]?.message ?? {};
      const content = typeof message.content === 'string' ? message.content : '';
      const thoughts = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';

      return {
        text: content,
        reasoning: thoughts,
        toolCalls: (message.tool_calls as WireToolCall[] | undefined) ?? [],
        usage: readUsage(payload.usage),
        finishReason: payload.choices?.[0]?.finish_reason ?? null,
        ttftMs: null,
        totalMs: Date.now() - started,
        attempts: attempt,
      };
    } catch (error) {
      const retryable = error instanceof DeepSeekError ? error.retryable : true;
      if (!retryable || attempt >= MAX_ATTEMPTS || params.signal?.aborted) throw error;
      await sleep(attempt, params.signal);
    }
  }
}

/**
 * JSON-mode helper that survives the model wrapping its object in prose or
 * fences. Returns `null` rather than throwing so callers can degrade to a local
 * fallback instead of failing a turn.
 */
export async function completeJson<T>(params: ChatParams): Promise<{ value: T | null; result: ChatResult }> {
  const result = await completeChat({ ...params, jsonMode: true, stream: false });
  const raw = result.text.trim();
  const candidates = [raw];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate) as T, result };
    } catch {
      continue;
    }
  }
  return { value: null, result };
}

/** Account balance, used by the insights panel to show runway. */
export async function fetchBalance(): Promise<{ available: boolean; usd: number } | null> {
  try {
    const response = await fetch(`${baseUrl(false)}/user/balance`, {
      headers: { authorization: `Bearer ${apiKey()}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      is_available?: boolean;
      balance_infos?: { currency?: string; total_balance?: string }[];
    };
    const usd = payload.balance_infos?.find((info) => info.currency === 'USD');
    return {
      available: payload.is_available !== false,
      usd: Number(usd?.total_balance ?? 0),
    };
  } catch {
    return null;
  }
}

/** Live model catalogue, so the picker reflects what the key can actually reach. */
export async function fetchModels(): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl(false)}/models`, {
      headers: { authorization: `Bearer ${apiKey()}` },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: { id?: string }[] };
    return (payload.data ?? []).map((model) => model.id ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

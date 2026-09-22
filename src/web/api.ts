/**
 * Typed client for the frozen HTTP contract.
 *
 * Every route in the contract doc has exactly one function here, grouped by
 * resource. Nothing in the UI touches `fetch` directly — that keeps the error
 * envelope (`{error, detail}`) in one place, which matters because a failed
 * DeepSeek call is the single most useful thing to show the writer verbatim.
 */

import type {
  AccountInfo,
  ArchivistResult,
  BranchBody,
  ConductorResult,
  DiagnoseReport,
  DirectorResult,
  ExportFormat,
  ImportBody,
  Insights,
  StoryBundle,
  StoryCreateBody,
  SummaryResult,
  VariantBody,
  WarmupResult,
} from '../shared/api.ts';
import type {
  Character,
  ChatRequest,
  CostEvent,
  DirectorNote,
  LoreEntry,
  Memory,
  Message,
  PayloadPlan,
  Persona,
  ReasoningEffort,
  Role,
  Scene,
  Story,
  StreamEvent,
  Theme,
  Thread,
} from '../shared/types.ts';

/* -------------------------------------------------------------- transport */

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, message: string, detail: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  /** One-line form for toasts: `error` plus its `detail` when the server sent one. */
  get full(): string {
    return this.detail ? `${this.message} — ${this.detail}` : this.message;
  }
}

type ErrorEnvelope = { error?: unknown; detail?: unknown };

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Tolerant JSON reader: a proxy error page or an empty 204 must not throw. */
export async function safeJson<T>(response: Response): Promise<T | null> {
  const raw = await response.text().catch(() => '');
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function errorFrom(response: Response): Promise<ApiError> {
  const envelope = await safeJson<ErrorEnvelope>(response).catch(() => null);
  const message =
    asText(envelope?.error) ??
    (response.status === 0 ? 'The server is not reachable.' : `Request failed (${response.status}).`);
  return new ApiError(response.status, message, asText(envelope?.detail));
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'Cannot reach the Reepi server', cause instanceof Error ? cause.message : null);
  }
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return null as T;
  const body = await safeJson<T>(response);
  if (body === null) throw new ApiError(response.status, 'The server returned an empty response.');
  return body;
}

function json(method: string, body?: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  };
}

const enc = encodeURIComponent;

/* ---------------------------------------------------------------- streaming */

export type StreamHandlers = {
  /** Fired for every well-formed `StreamEvent` frame, in order. */
  onEvent: (event: StreamEvent) => void;
};

type FrameBatch = { frames: string[]; rest: string };

/**
 * Split an SSE buffer into complete frames. A frame is only considered complete
 * once its terminating blank line has arrived, so a chunk boundary landing
 * mid-JSON is never mistaken for a broken frame.
 */
function takeFrames(buffer: string): FrameBatch {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
}

function frameData(frame: string): string | null {
  const lines = frame.split(/\r?\n/);
  const chunks: string[] = [];
  for (const line of lines) {
    // `: keep-alive` comments and any other field are ignorable per the SSE spec.
    if (line.startsWith(':') || line.length === 0) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== 'data') continue;
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    chunks.push(value);
  }
  return chunks.length > 0 ? chunks.join('\n') : null;
}

/**
 * POST `/api/chat` and consume the `text/event-stream` of `StreamEvent` frames.
 * Returns the accumulated prose. Abort via `signal`; the reader is always
 * released, and an abort resolves (it is a normal way to end a turn).
 */
export async function streamChat(
  body: ChatRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch('/api/chat', json('POST', body, signal));
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new ApiError(response.status, 'The stream had no body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  const drain = (flush: boolean): void => {
    const { frames, rest } = takeFrames(buffer);
    const pending: string[] = [];
    for (const frame of frames) {
      const data = frameData(frame);
      if (data === null || data === '[DONE]') continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(data) as StreamEvent;
      } catch {
        // Torn frame: keep it, the remainder will arrive in the next chunk.
        pending.push(frame);
        continue;
      }
      if (event.type === 'text') text += event.delta;
      handlers.onEvent(event);
    }
    // Un-parsed frames go back into the buffer ahead of the partial remainder.
    const carry = pending.length > 0 ? `${pending.join('\n\n')}\n\n` : '';
    buffer = carry + rest;
    if (flush) buffer = '';
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain(false);
    }
    buffer += decoder.decode();
    drain(true);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return text;
    if (cause instanceof Error && cause.name === 'AbortError') return text;
    throw cause;
  } finally {
    reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return text;
}

/* ------------------------------------------------------------------ client */

export const api = {
  /* ---------------------------------------------------------------- meta */

  health: () => send<{ ok: boolean; version: string; keyPresent: boolean }>('/api/health'),
  meta: () => send<Record<string, unknown>>('/api/meta'),
  account: (signal?: AbortSignal) => send<AccountInfo>('/api/account', json('GET', undefined, signal)),
  refreshAccount: (signal?: AbortSignal) => send<AccountInfo>('/api/account', json('POST', {}, signal)),
  diagnose: (storyId?: string | null, signal?: AbortSignal) =>
    send<DiagnoseReport>(
      storyId ? `/api/diagnose?storyId=${enc(storyId)}` : '/api/diagnose',
      json('GET', undefined, signal),
    ),

  /* ------------------------------------------------------------- stories */

  stories: {
    list: (signal?: AbortSignal) => send<Story[]>('/api/stories', json('GET', undefined, signal)),
    create: (body: StoryCreateBody, signal?: AbortSignal) =>
      send<Story>('/api/stories', json('POST', body, signal)),
    bundle: (storyId: string, signal?: AbortSignal) =>
      send<StoryBundle>(`/api/stories/${enc(storyId)}/bundle`, json('GET', undefined, signal)),
    update: (storyId: string, patch: Partial<Story>, signal?: AbortSignal) =>
      send<Story>(`/api/stories/${enc(storyId)}`, json('PATCH', patch, signal)),
    remove: (storyId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/stories/${enc(storyId)}`, json('DELETE', undefined, signal)),
    duplicate: (storyId: string, signal?: AbortSignal) =>
      send<Story>(`/api/stories/${enc(storyId)}/duplicate`, json('POST', {}, signal)),
    setTheme: (storyId: string, theme: Theme, signal?: AbortSignal) =>
      send<Story>(`/api/stories/${enc(storyId)}`, json('PATCH', { theme }, signal)),
    setEffort: (storyId: string, effort: ReasoningEffort, signal?: AbortSignal) =>
      send<Story>(`/api/stories/${enc(storyId)}`, json('PATCH', { effort }, signal)),
    importChat: (
      storyId: string,
      messages: { role: Role; content: string }[],
      signal?: AbortSignal,
    ) => send<StoryBundle>(`/api/stories/${enc(storyId)}/import-chat`, json('POST', { messages }, signal)),
    branch: (storyId: string, body: BranchBody, signal?: AbortSignal) =>
      send<Story>(`/api/stories/${enc(storyId)}/branch`, json('POST', body, signal)),
  },

  /* -------------------------------------------------------------- scenes */

  scenes: {
    list: (storyId: string, signal?: AbortSignal) =>
      send<Scene[]>(`/api/stories/${enc(storyId)}/scenes`, json('GET', undefined, signal)),
    create: (storyId: string, patch: Partial<Scene>, signal?: AbortSignal) =>
      send<Scene>(`/api/stories/${enc(storyId)}/scenes`, json('POST', patch, signal)),
    update: (sceneId: string, patch: Partial<Scene>, signal?: AbortSignal) =>
      send<Scene>(`/api/scenes/${enc(sceneId)}`, json('PATCH', patch, signal)),
    remove: (sceneId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/scenes/${enc(sceneId)}`, json('DELETE', undefined, signal)),
  },

  /* ---------------------------------------------------------- characters */

  characters: {
    list: (storyId: string, signal?: AbortSignal) =>
      send<Character[]>(`/api/stories/${enc(storyId)}/characters`, json('GET', undefined, signal)),
    create: (storyId: string, patch: Partial<Character>, signal?: AbortSignal) =>
      send<Character>(`/api/stories/${enc(storyId)}/characters`, json('POST', patch, signal)),
    update: (characterId: string, patch: Partial<Character>, signal?: AbortSignal) =>
      send<Character>(`/api/characters/${enc(characterId)}`, json('PATCH', patch, signal)),
    remove: (characterId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/characters/${enc(characterId)}`, json('DELETE', undefined, signal)),
  },

  /* ------------------------------------------------------------ personas */

  personas: {
    list: (storyId: string, signal?: AbortSignal) =>
      send<Persona[]>(`/api/stories/${enc(storyId)}/personas`, json('GET', undefined, signal)),
    create: (storyId: string, patch: Partial<Persona>, signal?: AbortSignal) =>
      send<Persona>(`/api/stories/${enc(storyId)}/personas`, json('POST', patch, signal)),
    update: (personaId: string, patch: Partial<Persona>, signal?: AbortSignal) =>
      send<Persona>(`/api/personas/${enc(personaId)}`, json('PATCH', patch, signal)),
    remove: (personaId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/personas/${enc(personaId)}`, json('DELETE', undefined, signal)),
  },

  /* ---------------------------------------------------------------- lore */

  lore: {
    list: (storyId: string, signal?: AbortSignal) =>
      send<LoreEntry[]>(`/api/stories/${enc(storyId)}/lore`, json('GET', undefined, signal)),
    create: (storyId: string, patch: Partial<LoreEntry>, signal?: AbortSignal) =>
      send<LoreEntry>(`/api/stories/${enc(storyId)}/lore`, json('POST', patch, signal)),
    update: (loreId: string, patch: Partial<LoreEntry>, signal?: AbortSignal) =>
      send<LoreEntry>(`/api/lore/${enc(loreId)}`, json('PATCH', patch, signal)),
    remove: (loreId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/lore/${enc(loreId)}`, json('DELETE', undefined, signal)),
  },

  /* ------------------------------------------------------------ memories */

  memories: {
    list: (storyId: string, signal?: AbortSignal) =>
      send<Memory[]>(`/api/stories/${enc(storyId)}/memories`, json('GET', undefined, signal)),
    create: (storyId: string, patch: Partial<Memory>, signal?: AbortSignal) =>
      send<Memory>(`/api/stories/${enc(storyId)}/memories`, json('POST', patch, signal)),
    remove: (memoryId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/memories/${enc(memoryId)}`, json('DELETE', undefined, signal)),
  },

  /* --------------------------------------------------------------- notes */

  notes: {
    list: (storyId: string, signal?: AbortSignal) =>
      send<DirectorNote[]>(`/api/stories/${enc(storyId)}/notes`, json('GET', undefined, signal)),
    accept: (noteId: string, signal?: AbortSignal) =>
      send<DirectorNote>(`/api/notes/${enc(noteId)}/accept`, json('POST', {}, signal)),
    remove: (noteId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/notes/${enc(noteId)}`, json('DELETE', undefined, signal)),
  },

  /* ------------------------------------------------------------- threads */

  threads: {
    list: (storyId: string, signal?: AbortSignal) =>
      send<Thread[]>(`/api/stories/${enc(storyId)}/threads`, json('GET', undefined, signal)),
    create: (storyId: string, patch: Partial<Thread>, signal?: AbortSignal) =>
      send<Thread>(`/api/stories/${enc(storyId)}/threads`, json('POST', patch, signal)),
    update: (threadId: string, patch: Partial<Thread>, signal?: AbortSignal) =>
      send<Thread>(`/api/threads/${enc(threadId)}`, json('PATCH', patch, signal)),
    remove: (threadId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/threads/${enc(threadId)}`, json('DELETE', undefined, signal)),
  },

  /* ------------------------------------------------------------ messages */

  messages: {
    update: (messageId: string, patch: Partial<Message>, signal?: AbortSignal) =>
      send<Message>(`/api/messages/${enc(messageId)}`, json('PATCH', patch, signal)),
    remove: (messageId: string, signal?: AbortSignal) =>
      send<{ ok: true }>(`/api/messages/${enc(messageId)}`, json('DELETE', undefined, signal)),
    variant: (messageId: string, body: VariantBody, signal?: AbortSignal) =>
      send<Message>(`/api/messages/${enc(messageId)}/variant`, json('POST', body, signal)),
  },

  /* ----------------------------------------------------------------- turn */

  /** Dry run. Costs nothing; this is what drives the live cache meter. */
  plan: (body: ChatRequest, signal?: AbortSignal) =>
    send<PayloadPlan>('/api/plan', json('POST', body, signal)),

  chat: streamChat,

  /* -------------------------------------------------------- agentic passes */

  warm: (storyId: string, overrides?: ChatRequest['overrides'], signal?: AbortSignal) =>
    send<WarmupResult>(`/api/stories/${enc(storyId)}/warm`, json('POST', { overrides }, signal)),
  director: (storyId: string, effort?: ReasoningEffort, signal?: AbortSignal) =>
    send<DirectorResult>(`/api/stories/${enc(storyId)}/director`, json('POST', { effort }, signal)),
  archivist: (storyId: string, body?: { limit?: number; sinceSeq?: number }, signal?: AbortSignal) =>
    send<ArchivistResult>(`/api/stories/${enc(storyId)}/archivist`, json('POST', body ?? {}, signal)),
  summarise: (storyId: string, signal?: AbortSignal) =>
    send<SummaryResult>(`/api/stories/${enc(storyId)}/summarise`, json('POST', {}, signal)),
  conductor: (storyId: string, body?: { variants?: number; authorNote?: string }, signal?: AbortSignal) =>
    send<ConductorResult>(`/api/stories/${enc(storyId)}/conductor`, json('POST', body ?? {}, signal)),
  conductorEstimate: (storyId: string, variants: number, signal?: AbortSignal) =>
    send<{
      variants: number;
      totalTokens: number;
      stablePrefixTokens: number;
      estimatedCostUsd: number;
      worstCaseCostUsd: number;
      model: string;
    }>(`/api/stories/${enc(storyId)}/conductor`, json('POST', { variants, estimateOnly: true }, signal)),

  /* ------------------------------------------------------------- insights */

  insights: {
    forStory: (storyId: string, signal?: AbortSignal) =>
      send<Insights>(`/api/stories/${enc(storyId)}/insights`, json('GET', undefined, signal)),
    global: (signal?: AbortSignal) => send<Insights>('/api/insights', json('GET', undefined, signal)),
    costs: (storyId: string, signal?: AbortSignal) =>
      send<CostEvent[]>(`/api/stories/${enc(storyId)}/costs`, json('GET', undefined, signal)),
  },

  /* ---------------------------------------------------------- portability */

  importBundle: (body: ImportBody, signal?: AbortSignal) =>
    send<Story>('/api/import', json('POST', body, signal)),
};

/* ------------------------------------------------------------------ export */

function exportUrl(storyId: string, format: ExportFormat): string {
  return `/api/stories/${enc(storyId)}/export?format=${enc(format)}`;
}

/**
 * Trigger a browser download from the export endpoint. The server sets its own
 * filename, so we only fall back to a derived one when the header is missing.
 */
export async function downloadExport(
  storyId: string,
  format: ExportFormat,
  fallbackName = 'reepi',
): Promise<void> {
  const response = await fetch(exportUrl(storyId, format));
  if (!response.ok) throw await errorFrom(response);
  const blob = await response.blob();
  const extension = format === 'chara' ? 'png' : format === 'markdown' ? 'md' : 'json';
  const disposition = response.headers.get('content-disposition') ?? '';
  const named = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
  const filename = named?.[1] ? decodeURIComponent(named[1]) : `${fallbackName}.${extension}`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

/** Base64 (no data: prefix) for the `chara` PNG import path. */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

/** Turn any thrown value into a toast-ready sentence. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.full;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong.';
}

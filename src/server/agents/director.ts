/**
 * The Director pass — the stateful tool loop.
 *
 * Kept apart from the other passes because it is the only one that carries state
 * across rounds: pending tool calls, the reasoning echo the API demands, and the
 * collections it drains into the store once the loop stops.
 */

import type { DirectorNote, ModelId, ReasoningEffort } from '../../shared/types.ts';
import type { DirectorResult } from '../../shared/api.ts';
import { completeChat, type WireMessage, type WireTool } from '../deepseek.ts';
import { messages, notes, scenes, threads } from '../store/index.ts';
import {
  activeScene,
  buildTranscriptView,
  personaNameFor,
  recordSideCall,
  renderTranscript,
  requireStory,
  type AgentContext,
} from './context.ts';

/**
 * The Director is the only place `tools` appear. It reads the scene and writes
 * structured craft notes plus scene-state updates.
 *
 * Tool calls must echo `reasoning_content` on every subsequent request or the API
 * rejects the thread with a 400, so the loop tracks it even though the default
 * effort (`none`) never produces any.
 */
export const DIRECTOR_TOOLS: WireTool[] = [
  {
    type: 'function',
    function: {
      name: 'set_scene_state',
      description:
        'Record or correct one concrete, currently-true fact about the scene. Use terse present-tense values.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short field name, e.g. "Time", "Location", "Weather".' },
          value: { type: 'string', description: 'Terse value, e.g. "just past midnight".' },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_thread',
      description:
        'Register an unresolved narrative thread the narrator must keep holding. Phrase it as a short sentence.',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_thread',
      description: 'Mark a previously opened thread as resolved.',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note',
      description:
        'Leave a craft note for the narrator about what to do next. Be specific and prescriptive.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['observe', 'nudge', 'critique'],
            description: 'observe = what just happened; nudge = what to do next; critique = a craft problem.',
          },
          body: { type: 'string', description: 'One or two sentences, addressed to the narrator.' },
        },
        required: ['kind', 'body'],
        additionalProperties: false,
      },
    },
  },
];

export const DIRECTOR_SYSTEM = `You are a story director embedded in a collaborative fiction engine.

You never write prose. You read the recent scene and leave a small number of high-value notes for the narrator who writes the next beat, and you keep the scene's factual state accurate.

Priorities, in order:
1. Continuity. If the scene state is wrong or stale, fix it with set_scene_state.
2. Momentum. If the scene is stalling or repeating itself, leave a nudge that forces a concrete change.
3. Craft. If the prose is drifting into cliché, pacing problems, or a character's voice slipping, leave a critique.
4. Threads. Open a thread when a promise, threat, or question is raised. Close one when it is genuinely resolved.

Discipline:
- Leave at most three notes. One excellent note beats three adequate ones.
- Never restate what is already obvious in the transcript.
- Never write dialogue, description, or narration.
- If the scene is working, say so in one short observe note and change nothing else.

Call the tools you need, then stop.`;

export async function runDirector(
  storyId: string,
  options: { effort?: ReasoningEffort; signal?: AbortSignal } = {},
): Promise<DirectorResult | null> {
  const story = requireStory(storyId);
  const scene = activeScene(storyId);
  const view = buildTranscriptView(
    messages.list(storyId, scene?.id),
    personaNameFor(storyId),
    12,
  );
  if (view.length === 0) return null;

  const openThreads = threads.list(storyId).filter((thread) => thread.status === 'open');
  const context: AgentContext = {
    story,
    transcript: view,
    state: scene?.state ?? [],
    openThreads: openThreads.map((thread) => thread.label),
    existingMemories: [],
  };

  const pending: WireMessage[] = [
    { role: 'system', content: DIRECTOR_SYSTEM },
    { role: 'user', content: renderDirectorBrief(context) },
  ];

  const collected: Pick<DirectorNote, 'kind' | 'body'>[] = [];
  const stateUpdates: { key: string; value: string }[] = [];
  const threadsOpened = new Set<string>();
  const threadsClosed = new Set<string>();
  let costUsd = 0;
  let model: ModelId = 'deepseek-flash';

  const effort = options.effort ?? 'low';
  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await completeChat({
      messages: pending,
      model,
      effort,
      tools: DIRECTOR_TOOLS,
      maxTokens: 900,
      signal: options.signal,
    });
    costUsd += recordSideCall('director', storyId, model, result);

    if (result.toolCalls.length === 0) break;

    // The API demands a full reasoning echo whenever tools are in play.
    pending.push({
      role: 'assistant',
      content: result.text || null,
      ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const args = safeArgs(call.function.arguments);
      const outcome = applyDirectorTool(call.function.name, args, {
        collected,
        stateUpdates,
        threadsOpened,
        threadsClosed,
      });
      pending.push({ role: 'tool', tool_call_id: call.id, content: outcome });
    }
  }

  if (collected.length === 0 && stateUpdates.length === 0) return { notes: [], stateUpdates: [], threadsOpened: [], threadsClosed: [], costUsd };

  const lastMessage = [...view].reverse().find((line) => line.role === 'assistant');
  const anchorId = lastMessage
    ? (messages.list(storyId, scene?.id).filter((m) => m.role === 'assistant').at(-1)?.id ?? null)
    : null;

  for (const note of collected.slice(0, 4)) {
    notes.add({
      storyId,
      messageId: anchorId,
      kind: note.kind,
      body: note.body,
      payload: null,
      accepted: false,
    });
  }

  for (const update of stateUpdates) {
    if (scene) scenes.setState(scene.id, update.key, update.value);
  }

  for (const label of threadsOpened) threads.upsertOpen(storyId, label, scene?.id ?? null);
  for (const label of threadsClosed) threads.close(storyId, label);

  return {
    notes: collected.slice(0, 4),
    stateUpdates,
    threadsOpened: [...threadsOpened],
    threadsClosed: [...threadsClosed],
    costUsd,
  };
}

export function renderDirectorBrief(context: AgentContext): string {
  const state = context.state.length
    ? context.state.map((field) => `- ${field.key}: ${field.value}`).join('\n')
    : '(nothing recorded yet)';
  const open = context.openThreads.length
    ? context.openThreads.map((label) => `- ${label}`).join('\n')
    : '(none)';

  return [
    `Story: ${context.story.title}`,
    context.story.genre ? `Genre & tone:\n${context.story.genre}` : '',
    `\nRecorded scene state:\n${state}`,
    `\nOpen threads:\n${open}`,
    `\nRecent transcript:\n${renderTranscript(context.transcript)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function applyDirectorTool(
  name: string,
  args: Record<string, unknown>,
  sink: {
    collected: Pick<DirectorNote, 'kind' | 'body'>[];
    stateUpdates: { key: string; value: string }[];
    threadsOpened: Set<string>;
    threadsClosed: Set<string>;
  },
): string {
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  if (name === 'set_scene_state') {
    const key = text(args.key);
    const value = text(args.value);
    if (!key) return 'error: key is required';
    if (value.length > 200) return 'error: value too long, keep it terse';
    sink.stateUpdates.push({ key, value });
    return `recorded ${key} = ${value}`;
  }

  if (name === 'open_thread') {
    const label = text(args.label);
    if (!label) return 'error: label is required';
    sink.threadsOpened.add(label);
    return `thread open: ${label}`;
  }

  if (name === 'close_thread') {
    const label = text(args.label);
    if (!label) return 'error: label is required';
    sink.threadsClosed.add(label);
    return `thread closed: ${label}`;
  }

  if (name === 'note') {
    const body = text(args.body);
    const kind = text(args.kind) || 'observe';
    if (!body) return 'error: body is required';
    const allowed = kind === 'nudge' || kind === 'critique' ? kind : 'observe';
    sink.collected.push({ kind: allowed, body });
    return 'noted';
  }

  return `error: unknown tool ${name}`;
}

export function safeArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

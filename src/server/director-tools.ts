import type { WireTool } from './deepseek.ts';
import { memories, notes, scenes, threads } from './store/index.ts';

/**
 * Tools offered to the **Director** pass.
 *
 * These are deliberately not available to the narrator. Two reasons:
 *
 * 1. Anything in the narration request forces the API to require a full
 *    `reasoning_content` echo on every later turn, and forces thinking to stay on
 *    — which silently disables `temperature`. That is fatal for roleplay.
 * 2. Tool schemas are resent with every request. Leaving them out of the 99% path
 *    keeps the narration prefix smaller *and* byte-stable.
 *
 * So the narrator writes prose, and the Director edits structure. Different jobs,
 * different contexts, different cache profiles.
 */

export const DIRECTOR_INLINE_TOOLS: WireTool[] = [
  {
    type: 'function',
    function: {
      name: 'set_scene_state',
      description: 'Record one concrete, currently-true fact about the scene.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short field name, e.g. "Location".' },
          value: { type: 'string', description: 'Terse value, e.g. "the flooded archive".' },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Store a durable fact that will still matter many turns from now.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One standalone sentence naming the people involved.' },
          subject: { type: 'string', description: 'Character or place it concerns.' },
          kind: {
            type: 'string',
            enum: ['fact', 'relationship', 'promise', 'trait', 'place'],
          },
        },
        required: ['text', 'kind'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_thread',
      description: 'Register an unresolved narrative thread.',
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
      description: 'Mark a previously opened thread resolved.',
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
      description: 'Leave a brief craft note for the narrator.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['observe', 'nudge', 'critique'] },
          body: { type: 'string' },
        },
        required: ['kind', 'body'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Apply one inline tool call and return a short outcome string for the `tool`
 * message. Never throws: a bad argument becomes a readable error the model can
 * recover from on its next round.
 */
export function applyInlineTool(
  storyId: string,
  sceneId: string,
  name: string,
  rawArgs: string,
): string {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArgs || '{}');
    if (typeof parsed === 'object' && parsed !== null) args = parsed as Record<string, unknown>;
  } catch {
    return `error: arguments were not valid JSON`;
  }

  const text = (value: unknown, fallback = ''): string =>
    typeof value === 'string' ? value.trim() : fallback;

  if (name === 'set_scene_state') {
    const key = text(args.key);
    const value = text(args.value);
    if (!key) return 'error: key is required';
    scenes.setState(sceneId, key, value);
    return value ? `scene state: ${key} = ${value}` : `scene state: ${key} cleared`;
  }

  if (name === 'remember') {
    const body = text(args.text);
    if (body.length < 8) return 'error: text is too short to be worth storing';
    const kindRaw = text(args.kind, 'fact');
    const kind: MemoryKind =
      kindRaw === 'relationship' || kindRaw === 'promise' || kindRaw === 'trait' || kindRaw === 'place'
        ? kindRaw
        : 'fact';
    const recent = memories.list(storyId, 1);
    memories.add({
      storyId,
      text: body,
      subject: text(args.subject),
      sourceMessageId: null,
      seq: (recent[0]?.seq ?? 0) + 1,
      salience: 0.6,
      kind,
    });
    return `remembered: ${body}`;
  }

  if (name === 'open_thread') {
    const label = text(args.label);
    if (!label) return 'error: label is required';
    threads.upsertOpen(storyId, label, sceneId);
    return `thread open: ${label}`;
  }

  if (name === 'close_thread') {
    const label = text(args.label);
    if (!label) return 'error: label is required';
    threads.close(storyId, label);
    return `thread closed: ${label}`;
  }

  if (name === 'note') {
    const body = text(args.body);
    if (!body) return 'error: body is required';
    const kindRaw = text(args.kind, 'observe');
    const kind =
      kindRaw === 'nudge' || kindRaw === 'critique' ? kindRaw : 'observe';
    notes.add({
      storyId,
      messageId: null,
      kind,
      body,
      payload: null,
      accepted: kind === 'nudge',
    });
    return `noted (${kind}): ${body}`;
  }

  return `error: unknown tool ${name}`;
}

type MemoryKind = 'fact' | 'relationship' | 'promise' | 'trait' | 'place';

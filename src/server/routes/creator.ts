/**
 * The creation assistant: its conversation, and one turn of it.
 *
 * The assistant is **app-scoped**. Its chat is not a story and never becomes a
 * transcript — nothing in `creator_messages` is ever read by the composer — and
 * the story a turn may write into is an explicit parameter rather than an ambient
 * "whatever is open". That is what makes the surface safe: the writer always knows
 * which world a turn can touch, and `targetStoryId: null` is a legitimate way to
 * work (characters become library cards with no home, templates are app-scoped,
 * and a whole story can be created by the turn itself).
 *
 * Three routes, one per verb a conversation needs:
 *
 * - `GET  /api/creator/messages` — read the thread back, oldest first.
 * - `POST /api/creator`          — run one turn, then record both messages.
 * - `DELETE /api/creator/messages` — start a new chat. The conversation goes;
 *   everything it wrote stays, because the rows were always the durable part.
 *
 * The pass itself lives in `../agents/creator.ts`, because that is where every
 * side-channel pass lives and where the rule that they never touch the narration
 * payload is enforced. This module owns the envelope, the thread and the target.
 */

import { Hono } from 'hono';
import { CREATOR_LIMITS, normaliseHistory, runCreator } from '../agents/creator.ts';
import { creator, stories } from '../store/index.ts';
import { fail, notFound, readBody } from '../http.ts';
import { MODEL_IDS, enumOf } from './library/shared.ts';
import type { CreatorMessage, ReasoningEffort } from '../../shared/types.ts';
import type { CreatorRequest, CreatorResponse, CreatorTurn } from '../../shared/api.ts';

const mod = new Hono();

/** Thinking stays off or minimal: this pass chooses structure, not prose. */
const EFFORTS: readonly ReasoningEffort[] = ['none', 'minimal', 'low'];

/** How much of the conversation the pass is shown, and how much the page reads. */
const HISTORY_TURNS = 8;

mod.get('/creator/messages', (c) => {
  const limit = Number(c.req.query('limit') ?? 200);
  return c.json<CreatorMessage[]>(creator.list(Number.isFinite(limit) ? limit : 200));
});

mod.delete('/creator/messages', (c) => {
  creator.clear();
  return c.json<{ ok: true }>({ ok: true });
});

mod.post('/creator', async (c) => {
  const body = await readBody<CreatorRequest>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const request = typeof body.request === 'string' ? body.request.trim() : '';
  if (!request) return fail(c, 400, 'Invalid body', '`request` is required.');
  if (request.length > CREATOR_LIMITS.requestChars) {
    return fail(c, 400, 'That request is too long', `Keep it under ${CREATOR_LIMITS.requestChars} characters.`);
  }

  /* The target is explicit, and a named one has to exist: the guard is what stops
     a turn writing into nothing and reporting success. Omitting it is legal —
     that is the library-only and create-a-story case. */
  const targetStoryId =
    typeof body.targetStoryId === 'string' && body.targetStoryId ? body.targetStoryId : null;
  if (targetStoryId && !stories.get(targetStoryId)) return notFound(c, 'Story');

  const model = enumOf(body.model ?? 'deepseek-flash', MODEL_IDS);
  if (!model) return fail(c, 400, 'Unknown model', `Expected one of: ${MODEL_IDS.join(', ')}.`);
  const effort = enumOf(body.effort, EFFORTS) ?? 'low';
  const allowOverwrite = body.allowOverwrite === true;

  /* Tie the call to the client hanging up, so a stopped turn stops billing rather
     than running to completion and being thrown away. */
  const controller = new AbortController();
  c.req.raw.signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const result = await runCreator(targetStoryId, request, historyFor(), {
      model,
      effort,
      allowOverwrite,
      signal: controller.signal,
    });

    if (controller.signal.aborted) {
      /* Nothing was applied and nothing is recorded: a stopped turn is not part of
         the conversation. It is a success, not an error — the writer asked for it. */
      return c.json<CreatorResponse>({ aborted: true, turn: null });
    }

    /* Both messages, or neither. A receipt with no question above it, or a
       question with no answer, would both be a lie about what was said. */
    const turn: CreatorTurn = {
      request: creator.add({
        role: 'user',
        body: request,
        allowOverwrite,
        targetStoryId: result.newStoryId ?? targetStoryId,
      }),
      reply: creator.add({
        role: 'assistant',
        body: result.reply,
        receipt: result,
        allowOverwrite,
        targetStoryId: result.newStoryId ?? targetStoryId,
      }),
    };

    return c.json<CreatorResponse>({ aborted: false, turn });
  } catch (error) {
    if (controller.signal.aborted) return c.json<CreatorResponse>({ aborted: true, turn: null });
    return fail(c, 500, 'The creation assistant failed', error instanceof Error ? error.message : String(error));
  }
});

/**
 * The conversation the pass is shown: the last few exchanges, as role/content.
 *
 * Read from the stored thread rather than accepted from the client, so the model's
 * memory of the conversation is the same thing the writer can see — and so a
 * reloaded page does not silently lose the context a follow-up depends on.
 */
function historyFor() {
  const messages = creator.list(HISTORY_TURNS * 2);
  return normaliseHistory(
    messages.map((message) => ({
      role: message.role,
      /* A receipt is not conversation: the model is shown what it said, not the
         JSON it wrote. The rows it made are visible in the brief instead. */
      content: message.body,
    })),
  );
}

export default mod;

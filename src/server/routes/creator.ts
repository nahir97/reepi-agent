/**
 * The creation assistant route.
 *
 * One endpoint, one pass. The shape of the request is the interesting part: the
 * target story is optional (templates are app-scoped, and a story can be created
 * in the same turn), `allowOverwrite` is the only key that can unlock replacing a
 * block that already has text, and `history` is the page's in-session log so a
 * follow-up has something to refer to.
 *
 * The pass itself lives in `../agents/creator.ts`, because that is where every
 * side-channel pass lives and where the rule that they never touch the narration
 * payload is enforced. This module only validates the envelope.
 */

import { Hono } from 'hono';
import { CREATOR_LIMITS, runCreator } from '../agents/creator.ts';
import { stories } from '../store/index.ts';
import { fail, notFound, readBody } from '../http.ts';
import { MODEL_IDS, enumOf } from './library/shared.ts';
import type { CreatorRequest } from '../../shared/api.ts';
import type { ReasoningEffort } from '../../shared/types.ts';

const mod = new Hono();

/** Thinking stays off or minimal: this pass chooses structure, not prose. */
const EFFORTS: readonly ReasoningEffort[] = ['none', 'minimal', 'low'];

mod.post('/creator', async (c) => {
  const body = await readBody<CreatorRequest>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const request = typeof body.request === 'string' ? body.request.trim() : '';
  if (!request) return fail(c, 400, 'Invalid body', '`request` is required.');
  if (request.length > CREATOR_LIMITS.requestChars) {
    return fail(c, 400, 'That request is too long', `Keep it under ${CREATOR_LIMITS.requestChars} characters.`);
  }

  /* A named story has to exist: the guard is what stops the assistant writing
     into nothing and reporting success. Omitting it is legal — that is the
     template-only and create-a-story case. */
  const storyId = typeof body.storyId === 'string' && body.storyId ? body.storyId : null;
  if (storyId && !stories.get(storyId)) return notFound(c, 'Story');

  const model = enumOf(body.model ?? 'deepseek-flash', MODEL_IDS);
  if (!model) return fail(c, 400, 'Unknown model', `Expected one of: ${MODEL_IDS.join(', ')}.`);
  const effort = enumOf(body.effort, EFFORTS) ?? 'low';

  try {
    /* The raw log goes to the pass, which bounds it — one cap, one owner. */
    const result = await runCreator(storyId, request, body.history, {
      model,
      effort,
      allowOverwrite: body.allowOverwrite === true,
    });
    return c.json(result);
  } catch (error) {
    return fail(c, 500, 'The creation assistant failed', error instanceof Error ? error.message : String(error));
  }
});

export default mod;

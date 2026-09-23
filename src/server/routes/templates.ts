/**
 * Prompt templates and the macro reference.
 *
 * App-scoped rather than story-scoped: a template is text the writer reuses, and
 * applying it copies that text into a story instead of pointing at the row — which
 * is what lets a story keep resolving its macros after the template is deleted.
 *
 * The code-shipped starters are merged in ahead of the stored rows and marked
 * `builtin`. Writing to one is refused rather than silently ignored, because the
 * alternative — accepting a PATCH against a constant — looks like a successful save
 * that disappears on the next reload.
 *
 * `GET /api/macros` is here rather than under a story because it answers a question
 * about the *editor*: what would each macro say for this story right now. It reads
 * through the composer's own resolver, so the reference panel cannot promise
 * something the payload would not do.
 */

import { Hono } from 'hono';
import { fail, readBody } from '../http.ts';
import { activeScene } from '../agents/context.ts';
import { BUILTIN_TEMPLATES, isBuiltinTemplateId } from '../templates.ts';
import { macroCatalogue, macroContextOf } from '../macros.ts';
import { stories, templates, threads } from '../store/index.ts';
import { transaction } from '../db.ts';
import { param, reject } from './library/shared.ts';
import { sanitisePromptTemplate } from './library/sanitise.ts';
import type { MacroInfo, PromptTemplateBody } from '../../shared/api.ts';
import type { PromptTemplate } from '../../shared/types.ts';

const mod = new Hono();

/* -- templates ------------------------------------------------------------ */

mod.get('/templates', (c) => c.json<PromptTemplate[]>([...BUILTIN_TEMPLATES, ...templates.list()]));

mod.post('/templates', async (c) => {
  const body = await readBody<PromptTemplateBody>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitisePromptTemplate(body);
  if (sanitised.rejected.length > 0) return reject(c, 'template fields', sanitised.rejected);

  const name = (sanitised.patch.name ?? '').trim();
  if (!name) return fail(c, 400, 'Invalid template', 'A template needs a name.');

  const blocks = sanitised.patch.blocks ?? {};
  if (Object.keys(blocks).length === 0) {
    return fail(c, 400, 'Invalid template', 'A template needs at least one block of text.');
  }

  return c.json<PromptTemplate>(templates.create({ ...sanitised.patch, name, blocks }));
});

mod.patch('/templates/:id', async (c) => {
  const id = param(c, 'id');
  if (isBuiltinTemplateId(id)) {
    return fail(c, 409, 'Built-in templates are read-only', 'Duplicate it to edit.');
  }
  if (!templates.get(id)) return fail(c, 404, 'Template not found');

  const body = await readBody<PromptTemplateBody>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitisePromptTemplate(body);
  if (sanitised.rejected.length > 0) return reject(c, 'template fields', sanitised.rejected);

  /* A rename to nothing and an emptied-out template are both refused: a nameless
     row is unlistable, and a template with no blocks is a button that does
     nothing. */
  if (sanitised.patch.name !== undefined && !sanitised.patch.name.trim()) {
    return fail(c, 400, 'Invalid template', 'A template needs a name.');
  }
  if (sanitised.patch.blocks !== undefined && Object.keys(sanitised.patch.blocks).length === 0) {
    return fail(c, 400, 'Invalid template', 'A template needs at least one block of text.');
  }

  const updated = templates.update(id, sanitised.patch);
  return updated ? c.json<PromptTemplate>(updated) : fail(c, 404, 'Template not found');
});

mod.delete('/templates/:id', (c) => {
  const id = param(c, 'id');
  if (isBuiltinTemplateId(id)) {
    return fail(c, 409, 'Built-in templates are read-only', 'Duplicate it to edit.');
  }
  if (!templates.get(id)) return fail(c, 404, 'Template not found');

  /* The story keeps the words — that has always been true — and it stops claiming
     the template, because the link is now the only thing that could dangle. In one
     transaction: a story pointing at a deleted template would report a prompt it
     does not have. */
  transaction(() => {
    stories.clearTemplate(id);
    templates.remove(id);
  });
  return c.json<{ ok: true }>({ ok: true });
});

/* -- the macro reference -------------------------------------------------- */

mod.get('/macros', (c) => {
  const storyId = c.req.query('storyId') ?? '';
  const story = storyId ? stories.get(storyId) : null;
  /* No story, or one that has been deleted: the reference still lists every
     macro by name, label and hint, with `value: null`. Writing a template does
     not require an open story. */
  if (!story) return c.json<MacroInfo[]>(macroCatalogue(null));

  const context = macroContextOf(story, activeScene(story.id), threads.list(story.id));
  return c.json<MacroInfo[]>(macroCatalogue(context));
});

export default mod;

/**
 * Library routes barrel.
 *
 * The module was one 1200-line file with three unrelated jobs: input validation,
 * story recreation, and the HTTP handlers. They are now separate files, and this
 * barrel keeps the public surface identical — `import libraryRoutes from
 * './routes/library.ts'` and `import { recreateStoryBundle } from './library.ts'`
 * both still work, so no caller had to learn about the split.
 */

export { default } from './library/routes.ts';

/* Validation is reused by the memory routes; recreation by import/duplication. */
export {
  sanitiseCharacter,
  sanitiseLore,
  sanitiseMemory,
  sanitiseMessage,
  sanitiseNote,
  sanitisePersona,
  sanitiseScene,
  sanitiseStory,
  sanitiseThread,
} from './library/sanitise.ts';
export { type BundleSeed, cloneStoryBundle, recreateStoryBundle } from './library/bundle.ts';
export { type Sanitised } from './library/shared.ts';

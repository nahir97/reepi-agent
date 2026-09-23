/**
 * The agentic layer.
 *
 * **Design constraint that shapes everything here:** the narration request must
 * keep a pristine, cache-blastable prefix, which means it carries no `tools` and
 * no chain-of-thought (see `deepseek.ts` for why). So agents never run inline
 * with narration. They run as **side-channel calls**, and their output re-enters
 * the story as text in the *volatile tail* of the next narration payload — where
 * churn is free.
 *
 * A pass that reads the story does not build a context of its own. It composes the
 * story with `composePass`: the narration head byte for byte, plus its own brief
 * where the narration tail would sit, so the API serves it from the cache unit the
 * last turn persisted instead of a private miss. The Director does that (see
 * `.agents/notes/implemented/architecture/2026-09-23-a-pass-rides-the-story-prefix.md`).
 * The Summariser cannot — it compresses exactly what the history window drops, which
 * sits *behind* the head — and the Creator has no story open to ride, so those two
 * keep a context of their own.
 *
 * Every call routes its real usage through `recordSideCall`, so the cost ledger
 * shows agentic spend separately from narration spend.
 *
 * This was one 900-line file holding five unrelated passes. Each pass now owns a
 * module, and this barrel keeps the public surface identical — callers keep
 * importing from `./agents.ts`, so the split stays invisible to them. The shared
 * machinery every pass depends on lives in `context.ts`, so there is exactly one
 * copy of it.
 */

export {
  SIDE_EFFORT,
  recordSideCall,
  type TranscriptView,
  buildTranscriptView,
  renderTranscript,
  requireStory,
  storiesSafe,
  activeScene,
  personaNameFor,
} from './context.ts';

export {
  DIRECTOR_TOOLS,
  DIRECTOR_SYSTEM,
  directorMode,
  runDirector,
  renderDirectorBrief,
  applyDirectorTool,
  safeArgs,
} from './director.ts';

export { ARCHIVIST_SYSTEM, runArchivist, normaliseForCompare } from './archivist.ts';

export {
  CREATOR_LIMITS,
  CREATOR_SYSTEM,
  CREATOR_TOOLS,
  applyCreatorDrafts,
  applyCreatorTool,
  creatorState,
  emptySink,
  normaliseHistory,
  renderCreatorBrief,
  runCreator,
  safeArgs as safeCreatorArgs,
  type CreatorDraft,
  type CreatorOptions,
  type CreatorSink,
  type CreatorState,
} from './creator.ts';

export { SUMMARISER_SYSTEM, runSummarise } from './summariser.ts';

export { runConductor, judgeVariants, estimateConductorCost } from './conductor.ts';

export { runDiagnose } from './diagnose.ts';

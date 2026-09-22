/**
 * The agentic layer.
 *
 * **Design constraint that shapes everything here:** the narration request must
 * keep a pristine, cache-blastable prefix, which means it carries no `tools` and
 * no chain-of-thought (see `deepseek.ts` for why). So agents never run inline
 * with narration. They run as **side-channel calls in their own separate
 * contexts**, and their output re-enters the story as text in the *volatile tail*
 * of the next narration payload — where churn is free.
 *
 * That is not a workaround, it is the better architecture: an agent's job is to
 * produce a small, durable artefact (a note, a fact, a state update). Paying for
 * it once and reusing it across turns is strictly cheaper than re-deriving it
 * inside every narration call.
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
  type AgentContext,
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
  runDirector,
  renderDirectorBrief,
  applyDirectorTool,
  safeArgs,
} from './director.ts';

export { ARCHIVIST_SYSTEM, runArchivist, normaliseForCompare } from './archivist.ts';

export { SUMMARISER_SYSTEM, runSummarise } from './summariser.ts';

export { runConductor, judgeVariants, estimateConductorCost } from './conductor.ts';

export { runDiagnose } from './diagnose.ts';

/**
 * Agentic passes barrel.
 *
 * The five passes moved into `./agents/`, one module each, with their shared
 * context helpers in `./agents/context.ts`. This file re-exports the same names it
 * always did, so every caller keeps importing `./agents.ts` untouched and the
 * split stays invisible to them.
 */

export {
  runDirector,
  runArchivist,
  runSummarise,
  runConductor,
  judgeVariants,
  runDiagnose,
  activeScene,
  personaNameFor,
  estimateConductorCost,
} from './agents/index.ts';

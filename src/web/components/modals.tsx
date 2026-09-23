/**
 * Dialogs barrel.
 *
 * The dialogs themselves live in `./dialogs/`, one per file, over a shell they share.
 * Story settings is the important one: it exposes every prompt block with its live
 * token count and volatility, and it warns, specifically, about whatever editing that
 * block would invalidate. That warning is the product's whole argument stated where
 * the decision is actually being made.
 *
 * This file is a barrel and must stay one — `App.tsx` and `editors.tsx` keep importing
 * from here, so the split is invisible to every caller.
 */

export {
  useDialogA11y,
  Shell,
  StorySettingsDialog,
  ImportExportDialog,
  NewStoryDialog,
  NewChatDialog,
  PromptTemplatesDialog,
  ConfirmDialog,
} from './dialogs/index.ts';

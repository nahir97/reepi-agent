/**
 * Dialog barrel.
 *
 * One dialog per module, plus `shell.tsx` for the frame they share, so editing one
 * dialog opens only the code that dialog runs. This barrel keeps the public surface
 * to the dialogs themselves: callers import from `../modals.tsx` and no call site
 * learns about the split.
 */

export { useDialogA11y, Shell } from './shell.tsx';
export { StorySettingsDialog } from './story-settings.tsx';
export { ImportExportDialog } from './import-export.tsx';
export { NewStoryDialog } from './new-story.tsx';
export { NewChatDialog } from './new-chat.tsx';
export { PromptTemplatesDialog } from './prompt-templates.tsx';
export { ConfirmDialog } from './confirm.tsx';

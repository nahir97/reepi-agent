/**
 * The payload analysis, as a dialog.
 *
 * This lived in the story panel as a section you drilled into, and then briefly on
 * the panel's own front page. Both were the wrong place: the analysis answers "what
 * is the request I am about to send", which is a question you have while *writing*,
 * and the rail is a panel you keep open while reading. Worse, the rail's version
 * reported the cost of the request beside the prose it was competing with.
 *
 * So it moved to the control that measures it. The composer's cache pill is already
 * the one-line summary of the next turn — predicted hit, cost, saving — and tapping
 * it now opens this: every block, its token share, its volatility, whether it moved
 * since the last turn, and its exact rendered text.
 *
 * One thing was deliberately left out on the way. The section used to carry a
 * `Warm cache` button and a `Re-measure` button; both are in the composer's
 * overrides popover and the composer re-measures on every keystroke. A report is
 * allowed to be a report, and putting the actions in two places is how two places
 * start disagreeing.
 */

import { Shell } from '../dialogs/shell.tsx';
import { BlocksTab } from '../inspector/blocks.tsx';
import { useStore } from '../../store.ts';

export function PayloadDialog() {
  const openDialog = useStore((state) => state.openDialog);
  const bundle = useStore((state) => state.bundle);

  return (
    <Shell
      title="The next turn's payload"
      subtitle="Built and measured without spending anything. Block order is the order the provider sees, and anything a change touches takes everything after it cold."
      onClose={() => openDialog(null)}
      wide
    >
      {bundle ? (
        <BlocksTab />
      ) : (
        <p className="text-[12px] text-faint">Open a story first — a payload belongs to one.</p>
      )}
    </Shell>
  );
}

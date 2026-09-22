# Agent Note: The dialog focus trap moved focus on every keystroke

Status: implemented

## Problem

Typing into any field inside a dialog worked on a desktop and was unusable on a phone:
the first character moved focus out of the field, which dismissed the on-screen keyboard
mid-word. In the prompt-templates dialog the focus landed on the header's **close** button, so
the writer had to tap back into the field after every letter — and the next keypress after that
would have activated the button.

The cause was in `Shell`'s focus trap (`useDialogA11y` in `web/components/dialogs/shell.tsx`),
not in any dialog:

- The trap's effect listed `onClose` as a dependency, and **every caller passes a fresh arrow**
  (`onClose={() => openDialog(null)}`). React compares dependencies by identity, so the effect
  tore down and rebuilt on *every render* — and typing a character renders the dialog.
- Each teardown ran `previous?.focus()` (restoring focus to whatever had been active when the
  previous run started) and each setup ran `first.focus()`, where `first` is the first focusable
  control in DOM order — the header's close button.
- So every keystroke ended with focus on the close button. On a phone that is the keyboard
  closing; on a desktop it is focus vanishing out of the field being typed into.

A second, older defect in the same lines: the setup always focused `first`, so a caller's
`autoFocus` was overridden one tick after React applied it. The New-story dialog therefore
opened with the close button focused and its title field inert — the author's declared intent
losing to a generic rule.

## Decision

**The trap is keyed on `open` (and on nothing else), and the initial focus is explicit.**

- `onClose` moved into a ref (`close.current`) so the effect can depend on `open` alone. The
  keydown handler reads the ref at event time, so Escape still calls the current callback.
- The first control is focused **once, when the dialog opens**, not on every render. Teardown
  restores focus to the element that was focused before the dialog mounted — which is now the
  same element it captured at open, because the effect no longer re-runs on renders.
- `Shell` gained `initialFocus?: string`, a selector for the control that should take focus.
  New story passes `initialFocus="#ns-title"` and no longer relies on `autoFocus` at all.
- The Tab cycle still queries the focusable controls per keypress, so it picks up controls that
  appear or disappear while the dialog is open.

## Alternatives considered

**Require callers to pass a stable `onClose`** (`useCallback`, or a module-level handler).
Rejected: it makes every one of the six dialogs responsible for a property of the shell, and the
failure mode is silent and unpleasant — a writer's keyboard closing mid-word — so it would be
reintroduced the first time someone wrote a new dialog in the obvious way.

**Drop `onClose` from the dependencies and read it from the closure.** Rejected: that freezes
the first render's callback forever. It happens to be harmless today because every handler is
`() => openDialog(null)`, but it is a latent trap for the first dialog whose close behaviour
depends on state.

**Keep `autoFocus` and teach the trap to look for `[autofocus]`.** Rejected after checking the
DOM: React 19 applies autofocus during commit and does **not** reflect an `autofocus` attribute,
so the query finds nothing (verified in the browser: `hasAttribute('autofocus') === false` and
the input was not focused). An explicit prop on `Shell` is the mechanism that can be read,
tested, and trusted.

**Skip the initial focus entirely and let each dialog decide.** Rejected: a dialog that opens
with focus still on the page behind it is not a trap, it is a leak.

**Also autofocus the prompt-templates Name field whenever the editor mounts.** Rejected: the
dialog is a library as well as an editor, and on a phone that would raise the keyboard every time
it is opened. The New button is the deliberate act that wants a field focused; the editor merely
opening does not.

## Consequences

- Focus stays where the writer put it: typing any character into any field in any dialog (story
  settings' seven block areas, the template editor, the New-story title, import/export) no
  longer moves focus.
- Escape still closes, Tab still cycles inside the dialog, and on close focus returns to the
  control that opened it.
- `Shell` has one more prop, and a dialog that wants a specific first control now says which
  instead of relying on `autoFocus` being honoured by accident.
- The a11y hook is no longer re-created per render, so its keydown listener is added once per
  open rather than once per keystroke — fewer listener churn cycles in a typing session.

## Testing

Measured in the running app, in a production build, against a copy of the real database, with
`document.activeElement` read after a single **real** keystroke (`browser_keys`, not a synthetic
event):

| Surface | Before | After |
|---|---|---|
| Prompt templates → New → Name | `button[aria-label="Close dialog"]` | the Name input |
| Story settings → contract textarea | `button[aria-label="Close dialog"]` | the textarea |
| New story → Title, on open | `button[aria-label="Close dialog"]` | `#ns-title` |
| Tab from the last control | wraps to the close button | unchanged |
| Escape, then focus | returns to the trigger | unchanged |

The first reproduction attempt passed and was wrong: a manually dispatched `input` event does
not reach React's controlled-input path (its value tracker sees no change), so no re-render
happened and focus appeared stable. The bug only reproduces through the real key path — which is
also why the earlier verification sweep missed it, since those checks asserted rendered values
and layout widths and never asserted *focus*. Assert focus, and drive it with real keys.

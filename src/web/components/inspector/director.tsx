/**
 * Director: the agentic passes, their notes, and the running synopsis.
 */

import { useMemo } from 'react';
import type { DirectorNote } from '../../../shared/types.ts';
import { api } from '../../api.ts';
import { useStore } from '../../store.ts';
import { Card, SectionTitle } from '../panel.tsx';
import { IconCheck, IconNote, IconSpark, IconTrash, IconUsers, IconWand } from '../icons.tsx';
import { DraftField } from './shared.tsx';

/* ---------------------------------------------------------------- director */

const NOTE_COLOR: Record<DirectorNote['kind'], string> = {
  observe: 'var(--accent)',
  nudge: 'var(--warn)',
  state: 'var(--ok)',
  thread: 'var(--cache-hit)',
  critique: 'var(--danger)',
};

export function DirectorTab() {
  const bundle = useStore((state) => state.bundle);
  const acceptNote = useStore((state) => state.acceptNote);
  const dismissNote = useStore((state) => state.dismissNote);
  const runAgentic = useStore((state) => state.runAgentic);
  const busy = useStore((state) => state.busy);
  const updateScene = useStore((state) => state.updateScene);
  const activeScene = useStore((state) => state.activeScene);

  if (!bundle) return null;

  const notes = useMemo(() => [...bundle.notes].sort((a, b) => b.createdAt - a.createdAt), [bundle.notes]);

  const passes: { id: 'director' | 'archivist' | 'summarise' | 'conductor'; label: string; blurb: string }[] = [
    { id: 'director', label: 'Director', blurb: 'reads the turn, files notes and state updates' },
    { id: 'archivist', label: 'Archivist', blurb: 'distils durable memories' },
    { id: 'summarise', label: 'Summarise', blurb: 'rewrites the synopsis of what was trimmed' },
    { id: 'conductor', label: 'Conductor', blurb: 'drafts three continuations on one cached prefix' },
  ];

  return (
    <div>
      <SectionTitle title="Agentic passes" hint="separate contexts, never in the narration payload" />
      <Card>
        <p className="mb-2 text-[10.5px] leading-snug text-faint">
          Each pass runs in its own short-lived thread and hands back a tiny durable artefact. Paying for a summary
          once and reusing it across fifty turns is strictly cheaper than re-deriving continuity inside all fifty —
          and none of it touches the narrator's cache prefix.
        </p>
        <div className="grid gap-1.5">
          {passes.map((pass) => (
            <div key={pass.id} className="flex items-center gap-2">
              <button
                type="button"
                className="btn"
                style={{ padding: '0.3rem 0.55rem' }}
                disabled={busy !== null}
                onClick={() => void runAgentic(pass.id)}
              >
                {busy === pass.id ? 'Running…' : pass.label}
              </button>
              <span className="text-[10.5px] leading-snug text-faint">{pass.blurb}</span>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle title="Notes" hint={`${notes.length} filed · ${notes.filter((note) => !note.accepted).length} pending`} />

      {notes.length === 0 ? (
        <p className="text-[12px] leading-snug text-faint">
          No notes yet. Run the Director after a few turns — it reads the transcript and files observations, suggested
          state changes and thread bookkeeping that you accept or throw away.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map((note) => {
            const scene = activeScene();
            const suggested = note.payload && note.kind === 'state' ? note.payload : null;
            const values = suggested ? Object.entries(suggested).filter(([, value]) => typeof value === 'string') : [];
            return (
              <li key={note.id} className="card p-2.5" style={{ background: 'var(--panel-raised)' }}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="chip" style={{ color: NOTE_COLOR[note.kind], borderColor: 'var(--border-strong)' }}>
                    {note.kind}
                  </span>
                  {note.accepted ? <span className="chip chip-hit">accepted</span> : null}
                  <span className="num ml-auto text-[10px] text-faint">
                    {new Date(note.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="font-serif text-[12.5px] leading-snug">{note.body}</p>
                {values.length > 0 && scene ? (
                  <p className="num mt-1.5 text-[10.5px] text-faint">
                    suggests {values.map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}
                  </p>
                ) : null}
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '0.25rem 0.5rem' }}
                    disabled={note.accepted}
                    onClick={() => void acceptNote(note.id)}
                    title="Accepted notes are what the Director's brief is built from next turn"
                  >
                    <IconCheck size={11} />
                    Accept
                  </button>
                  {values.length > 0 && scene ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '0.25rem 0.5rem' }}
                      onClick={() => {
                        const next = [...scene.state];
                        for (const [key, value] of values) {
                          const existing = next.findIndex((field) => field.key === key);
                          if (existing >= 0) next[existing] = { key, value: String(value) };
                          else next.push({ key, value: String(value) });
                        }
                        void updateScene(scene.id, { state: next });
                      }}
                    >
                      <IconWand size={11} />
                      Apply to scene state
                    </button>
                  ) : null}
                  {note.kind === 'thread' ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '0.25rem 0.5rem' }}
                      onClick={() => {
                        void (async () => {
                          try {
                            await api.threads.create(bundle.story.id, {
                              label: note.body.slice(0, 120),
                              sceneId: scene?.id ?? null,
                              status: 'open',
                            });
                            await useStore.getState().refreshBundle({ quiet: true });
                          } catch (error) {
                            useStore.getState().fail(error, 'Could not open a thread');
                          }
                        })();
                      }}
                    >
                      <IconNote size={11} />
                      Open as thread
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn ml-auto"
                    style={{ width: 22, height: 22 }}
                    aria-label="Dismiss this note"
                    onClick={() => void dismissNote(note.id)}
                  >
                    <IconTrash size={11} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <SectionTitle title="Synopsis" hint="what the transcript no longer shows" />
        <DraftField
          id="story-synopsis"
          label="Running synopsis"
          value={bundle.story.synopsis}
          rows={5}
          tokens
          hint="Rewritten by Summarise, or by hand. It carries the trimmed past forward at a fraction of its token cost."
          onCommit={(synopsis) => void useStore.getState().updateStory({ synopsis })}
        />
      </Card>

      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => void runAgentic('director')} disabled={busy !== null}>
          <IconSpark size={11} />
          Run Director now
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void useStore.getState().openDialog({ kind: 'story-settings' })}
        >
          <IconUsers size={11} />
          Edit prompt blocks
        </button>
      </div>
    </div>
  );
}

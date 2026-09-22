/**
 * Scene: the live state of the scene, its notes and its open threads.
 */

import { useEffect, useState } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import { estimateTokens } from '../../../shared/tokens.ts';
import type { SceneStateField, Thread } from '../../../shared/types.ts';
import { api } from '../../api.ts';
import { useStore } from '../../store.ts';
import { Card, SectionTitle } from '../panel.tsx';
import { IconClose, IconPlus, IconTrash } from '../icons.tsx';
import { DraftField } from './shared.tsx';

/* ------------------------------------------------------------------- scene */

export function SceneTab() {
  const bundle = useStore((state) => state.bundle);
  const activeScene = useStore((state) => state.activeScene);
  const updateScene = useStore((state) => state.updateScene);
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);

  const scene = activeScene();
  const [draftState, setDraftState] = useState<SceneStateField[]>(scene?.state ?? []);

  useEffect(() => {
    setDraftState(scene?.state ?? []);
  }, [scene?.id, scene?.state]);

  if (!bundle || !scene) return <p className="text-[12px] text-faint">No scene in this story.</p>;

  const threads = bundle.threads.filter((thread) => thread.sceneId === scene.id || thread.sceneId === null);

  return (
    <div>
      <SectionTitle title="Scene" hint={`${scene.title} · vol 3, volatile tail`} />

      <Card>
        <label className="label" htmlFor="scene-title">
          Title
        </label>
        <input
          id="scene-title"
          className="field"
          defaultValue={scene.title}
          onBlur={(event) => {
            if (event.target.value !== scene.title) void updateScene(scene.id, { title: event.target.value });
          }}
        />
      </Card>

      <Card>
        <SectionTitle
          title="State"
          hint="structured facts the narrator tracks"
          action={
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.2rem 0.45rem' }}
              onClick={() => setDraftState([...draftState, { key: '', value: '' }])}
            >
              <IconPlus size={11} />
              Row
            </button>
          }
        />
        <p className="mb-2 text-[10.5px] leading-snug text-faint">
          Scene state changes most turns by design — it sits late in the payload, so a churning field only invalidates
          itself.
        </p>
        <ul className="space-y-1.5">
          {draftState.map((field, index) => (
            <li key={`state-${index}`} className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor={`state-key-${index}`}>
                State field {index + 1} key
              </label>
              <input
                id={`state-key-${index}`}
                className="field field-sm w-28 shrink-0"
                value={field.key}
                placeholder="time"
                onChange={(event) => {
                  const next = [...draftState];
                  next[index] = { key: event.target.value, value: field.value };
                  setDraftState(next);
                }}
              />
              <label className="sr-only" htmlFor={`state-value-${index}`}>
                State field {index + 1} value
              </label>
              <input
                id={`state-value-${index}`}
                className="field field-sm min-w-0 flex-1"
                value={field.value}
                placeholder="third bell, after the flood"
                onChange={(event) => {
                  const next = [...draftState];
                  next[index] = { key: field.key, value: event.target.value };
                  setDraftState(next);
                }}
              />
              <button
                type="button"
                className="icon-btn shrink-0"
                style={{ width: 22, height: 22 }}
                aria-label={`Remove state field ${index + 1}`}
                onClick={() => setDraftState(draftState.filter((_, position) => position !== index))}
              >
                <IconClose size={11} />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '0.3rem 0.55rem' }}
            onClick={() => void updateScene(scene.id, { state: draftState.filter((field) => field.key.trim()) })}
          >
            Save state
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.3rem 0.55rem' }}
            onClick={() => setDraftState(scene.state)}
          >
            Revert
          </button>
          <span className="num ml-auto text-[10px] text-faint">
            {formatTokens(estimateTokens(draftState.map((field) => `${field.key}: ${field.value}`).join('\n')))} tok
          </span>
        </div>
      </Card>

      <Card>
        <DraftField
          id="scene-notes"
          label="Writer's notes"
          value={scene.notes}
          rows={4}
          hint="Yours. Never sent to the model — this is scaffolding, not payload."
          onCommit={(notes) => void updateScene(scene.id, { notes })}
        />
      </Card>

      <Card>
        <SectionTitle
          title="Threads"
          hint={`${threads.filter((thread) => thread.status === 'open').length} open`}
          action={
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.2rem 0.45rem' }}
              onClick={() => {
                void (async () => {
                  try {
                    await api.threads.create(bundle.story.id, { label: 'New thread', sceneId: scene.id, status: 'open' });
                    await refreshBundle({ quiet: true });
                  } catch (error) {
                    fail(error, 'Could not open a thread');
                  }
                })();
              }}
            >
              <IconPlus size={11} />
              Thread
            </button>
          }
        />
        {threads.length === 0 ? (
          <p className="text-[11.5px] text-faint">
            No threads. Open threads are the Director's list of promises the narration still owes the reader.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ThreadRow({ thread }: { thread: Thread }) {
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);
  const [label, setLabel] = useState(thread.label);

  const patch = async (next: Partial<Thread>): Promise<void> => {
    try {
      await api.threads.update(thread.id, next);
      await refreshBundle({ quiet: true });
    } catch (error) {
      fail(error, 'Could not update the thread');
    }
  };

  return (
    <li className="flex items-center gap-1.5">
      <button
        type="button"
        className="switch shrink-0"
        role="switch"
        aria-checked={thread.status === 'open'}
        aria-label={`${thread.label} is ${thread.status}`}
        onClick={() =>
          void patch({
            status: thread.status === 'open' ? 'closed' : 'open',
            resolvedAt: thread.status === 'open' ? new Date().toISOString() : null,
          })
        }
      />
      <input
        className="field field-sm min-w-0 flex-1"
        value={label}
        aria-label="Thread label"
        onChange={(event) => setLabel(event.target.value)}
        onBlur={() => {
          if (label !== thread.label) void patch({ label });
        }}
      />
      <span className={`chip shrink-0 ${thread.status === 'open' ? 'chip-accent' : ''}`}>{thread.status}</span>
      <button
        type="button"
        className="icon-btn shrink-0"
        style={{ width: 22, height: 22 }}
        aria-label={`Delete thread ${thread.label}`}
        onClick={() => {
          void (async () => {
            try {
              await api.threads.remove(thread.id);
              await refreshBundle({ quiet: true });
            } catch (error) {
              fail(error, 'Could not delete the thread');
            }
          })();
        }}
      >
        <IconTrash size={11} />
      </button>
    </li>
  );
}

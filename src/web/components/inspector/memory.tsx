/**
 * Memory: durable facts, recalled by relevance into the volatile tail.
 */

import { useState } from 'react';
import { MEMORY_KINDS } from '../../../shared/types.ts';
import type { Memory } from '../../../shared/types.ts';
import { api } from '../../api.ts';
import { useStore } from '../../store.ts';
import { Card, SectionTitle } from '../panel.tsx';
import { IconClapper, IconPlus, IconTrash } from '../icons.tsx';

/* ------------------------------------------------------------------ memory */


export function MemoryTab() {
  const bundle = useStore((state) => state.bundle);
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);
  const runAgentic = useStore((state) => state.runAgentic);
  const busy = useStore((state) => state.busy);
  const plan = useStore((state) => state.plan);

  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [kind, setKind] = useState<Memory['kind']>('fact');
  const [salience, setSalience] = useState(0.7);

  if (!bundle) return null;
  const recalled = new Set((plan?.retrieval ?? []).map((item) => item.memoryId));

  const add = async (): Promise<void> => {
    if (!text.trim()) return;
    try {
      await api.memories.create(bundle.story.id, { text: text.trim(), subject: subject.trim(), kind, salience });
      await refreshBundle({ quiet: true });
      setText('');
      setSubject('');
    } catch (error) {
      fail(error, 'Could not add the memory');
    }
  };

  return (
    <div>
      <SectionTitle
        title="Memory"
        hint={`${bundle.memories.length} recalled facts`}
        action={
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.2rem 0.45rem' }}
            disabled={busy === 'archivist'}
            onClick={() => void runAgentic('archivist')}
            title="Distil new memories from the recent transcript, in its own context"
          >
            <IconClapper size={11} />
            {busy === 'archivist' ? 'Running…' : 'Distil'}
          </button>
        }
      />

      <p className="mb-2 text-[10.5px] leading-snug text-faint">
        Memories are recalled by relevance and injected in the volatile tail, so growing this list costs nothing until
        a turn actually matches one. A memory the model never needs is not a liability — it is just a row.
      </p>

      <Card>
        <SectionTitle title="Add manually" />
        <label className="label" htmlFor="mem-text">
          Fact, as a standalone sentence
        </label>
        <textarea
          id="mem-text"
          className="field resize-none font-serif"
          rows={2}
          value={text}
          placeholder="Mira owes the archivist a favour she has not named yet."
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div>
            <label className="label" htmlFor="mem-subject">
              Subject
            </label>
            <input
              id="mem-subject"
              className="field field-sm"
              value={subject}
              placeholder="Mira"
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="mem-kind">
              Kind
            </label>
            <select
              id="mem-kind"
              className="field field-sm"
              value={kind}
              onChange={(event) => setKind(event.target.value as Memory['kind'])}
            >
              {MEMORY_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="mem-salience">
              Salience
            </label>
            <input
              id="mem-salience"
              className="field field-sm num"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={salience}
              onChange={(event) => setSalience(Number(event.target.value))}
            />
          </div>
        </div>
        <button type="button" className="btn btn-primary mt-2" onClick={() => void add()} disabled={!text.trim()}>
          <IconPlus size={11} />
          Add memory
        </button>
      </Card>

      {bundle.memories.length === 0 ? <p className="text-[12px] text-faint">Nothing remembered yet.</p> : null}

      <ul className="space-y-1.5">
        {bundle.memories.map((memory) => (
          <li key={memory.id} className="card p-2.5" style={{ background: 'var(--panel-raised)' }}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-serif text-[12.5px] leading-snug">{memory.text}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="chip">{memory.kind}</span>
                  {memory.subject ? <span className="chip">{memory.subject}</span> : null}
                  <span className="chip num">salience {memory.salience.toFixed(2)}</span>
                  <span className="chip num">seq {memory.seq}</span>
                  {recalled.has(memory.id) ? <span className="chip chip-hit">in this payload</span> : null}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn shrink-0"
                style={{ width: 22, height: 22 }}
                aria-label="Delete this memory"
                onClick={() => {
                  void (async () => {
                    try {
                      await api.memories.remove(memory.id);
                      await refreshBundle({ quiet: true });
                    } catch (error) {
                      fail(error, 'Could not delete the memory');
                    }
                  })();
                }}
              >
                <IconTrash size={11} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

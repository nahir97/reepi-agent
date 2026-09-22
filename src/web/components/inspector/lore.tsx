/**
 * Lore: the keyword-triggered book, anchored or injected per turn.
 */

import { formatTokens } from '../../../shared/cost.ts';
import type { LoreEntry, LorePosition } from '../../../shared/types.ts';
import { api } from '../../api.ts';
import { useStore } from '../../store.ts';
import { SectionTitle } from '../panel.tsx';
import { IconPlus, IconTrash } from '../icons.tsx';

/* -------------------------------------------------------------------- lore */

const POSITIONS: LorePosition[] = ['anchor', 'depth', 'before', 'after'];

export function LoreTab() {
  const bundle = useStore((state) => state.bundle);
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);
  const plan = useStore((state) => state.plan);

  if (!bundle) return null;

  const total = bundle.lore.reduce((sum, entry) => sum + entry.tokens, 0);
  const fired = new Set((plan?.loreHits ?? []).map((hit) => hit.entryId));

  const save = async (id: string, patch: Partial<LoreEntry>): Promise<void> => {
    try {
      await api.lore.update(id, patch);
      await refreshBundle({ quiet: true });
    } catch (error) {
      fail(error, 'Could not save the lore entry');
    }
  };

  return (
    <div>
      <SectionTitle
        title="Lorebook"
        hint={`${bundle.lore.length} entries · ${formatTokens(total)} tok in the book`}
        action={
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.2rem 0.45rem' }}
            onClick={() => {
              void (async () => {
                try {
                  await api.lore.create(bundle.story.id, { title: 'New entry', body: '' });
                  await refreshBundle({ quiet: true });
                } catch (error) {
                  fail(error, 'Could not add a lore entry');
                }
              })();
            }}
          >
            <IconPlus size={11} />
            Add
          </button>
        }
      />
      <p className="mb-2 text-[10.5px] leading-snug text-faint">
        Anchored entries join the frozen prefix; everything else is injected per turn inside the volatile tail. The
        token budget is <span className="num">{formatTokens(bundle.story.loreBudget)}</span>.
      </p>

      <div className="hide-scrollbar -mx-1 mb-2 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="eyebrow py-1.5 pr-2 font-semibold">Entry</th>
              <th className="eyebrow py-1.5 pr-2 font-semibold">Keys</th>
              <th className="eyebrow py-1.5 pr-2 font-semibold">Pos</th>
              <th className="eyebrow py-1.5 pr-2 font-semibold">Depth</th>
              <th className="eyebrow py-1.5 pr-2 font-semibold">Prio</th>
              <th className="eyebrow py-1.5 pr-2 font-semibold">Wt</th>
              <th className="eyebrow py-1.5 pr-2 font-semibold">Const</th>
              <th className="eyebrow py-1.5 pr-2 font-semibold">On</th>
              <th className="eyebrow py-1.5 pr-2 text-right font-semibold">Tok</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {bundle.lore.map((entry) => (
              <tr key={entry.id} className="border-b border-border/60 align-top" style={{ borderColor: 'var(--rule)' }}>
                <td className="py-1.5 pr-2">
                  <input
                    className="field field-sm"
                    aria-label={`Title for ${entry.title}`}
                    defaultValue={entry.title}
                    onBlur={(event) => {
                      if (event.target.value !== entry.title) void save(entry.id, { title: event.target.value });
                    }}
                  />
                  <div className="mt-1 flex items-center gap-1.5">
                    {fired.has(entry.id) ? <span className="chip chip-hit">fired</span> : null}
                    <textarea
                      className="field field-sm mt-0 w-full font-serif"
                      rows={2}
                      aria-label={`Body for ${entry.title}`}
                      defaultValue={entry.body}
                      onBlur={(event) => {
                        if (event.target.value !== entry.body) void save(entry.id, { body: event.target.value });
                      }}
                    />
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="field field-sm num"
                    aria-label={`Trigger keys for ${entry.title}`}
                    defaultValue={entry.keys}
                    placeholder="ash, crown"
                    onBlur={(event) => {
                      if (event.target.value !== entry.keys) void save(entry.id, { keys: event.target.value });
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <label className="sr-only" htmlFor={`lore-pos-${entry.id}`}>
                    Position for {entry.title}
                  </label>
                  <select
                    id={`lore-pos-${entry.id}`}
                    className="field field-sm"
                    value={entry.position}
                    onChange={(event) => void save(entry.id, { position: event.target.value as LorePosition })}
                  >
                    {POSITIONS.map((position) => (
                      <option key={position} value={position}>
                        {position}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="field field-sm num w-14"
                    type="number"
                    min={0}
                    max={64}
                    aria-label={`Depth for ${entry.title}`}
                    defaultValue={entry.depth}
                    onBlur={(event) => {
                      const next = Number(event.target.value) || 0;
                      if (next !== entry.depth) void save(entry.id, { depth: next });
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="field field-sm num w-14"
                    type="number"
                    aria-label={`Priority for ${entry.title}`}
                    defaultValue={entry.priority}
                    onBlur={(event) => {
                      const next = Number(event.target.value) || 0;
                      if (next !== entry.priority) void save(entry.id, { priority: next });
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="field field-sm num w-16"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label={`Weight for ${entry.title}`}
                    defaultValue={entry.weight}
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next) && next !== entry.weight) void save(entry.id, { weight: next });
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <button
                    type="button"
                    className="switch"
                    role="switch"
                    aria-checked={entry.constant}
                    aria-label={`Always inject ${entry.title}`}
                    onClick={() => void save(entry.id, { constant: !entry.constant })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <button
                    type="button"
                    className="switch"
                    role="switch"
                    aria-checked={entry.enabled}
                    aria-label={`Enable ${entry.title}`}
                    onClick={() => void save(entry.id, { enabled: !entry.enabled })}
                  />
                </td>
                <td className="num py-1.5 pr-2 text-right text-[10.5px] text-dim">{entry.tokens}</td>
                <td className="py-1.5">
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 22, height: 22 }}
                    aria-label={`Delete ${entry.title}`}
                    onClick={() => {
                      void (async () => {
                        try {
                          await api.lore.remove(entry.id);
                          await refreshBundle({ quiet: true });
                        } catch (error) {
                          fail(error, 'Could not delete the lore entry');
                        }
                      })();
                    }}
                  >
                    <IconTrash size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] leading-snug text-faint">
        Cells save on blur. Each save re-measures the payload, so the meter above is always the real next turn.
      </p>
    </div>
  );
}

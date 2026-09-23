/**
 * The writing surface.
 *
 * Two things live here that matter more than the textarea:
 *
 * 1. **The cache-safety sentence.** Above the input, it names the single block an
 *    edit broke and quantifies the damage in tokens — the one cache fact that is
 *    actionable *while writing*, because it is about the words just changed.
 * 2. **The overrides popover.** Model, effort, sampling, budgets — per turn only,
 *    because changing them permanently is exactly what breaks a prefix.
 *
 * What is deliberately *not* here is the cost pill. The next turn's predicted hit
 * rate, price and saving used to sit in this row, and every one of them is already
 * in `Turn details` (what the last turn actually cost) and in Settings → Payload
 * report (the block-by-block plan). A figure you cannot act on mid-sentence is a
 * figure that only takes pixels from the prose.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { countWords } from '../../shared/tokens.ts';
import { EFFORT_LABELS, MODELS } from '../../shared/types.ts';
import type { ChatRequest, ModelId, ReasoningEffort } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { cacheSafetySentence } from './cache-safety.ts';
import { PersonaSwitch } from './PersonaSwitch.tsx';
import { PromptPicker } from './PromptPicker.tsx';
import { IconAlert, IconClose, IconFeather, IconNote, IconSend, IconSettings, IconStop } from './icons.tsx';

const EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'max'];

export function Composer() {
  const bundle = useStore((state) => state.bundle);
  const activeScene = useStore((state) => state.activeScene);
  const plan = useStore((state) => state.plan);
  const schedulePlan = useStore((state) => state.schedulePlan);
  const streaming = useStore((state) => state.streaming);
  const runTurn = useStore((state) => state.runTurn);
  const abort = useStore((state) => state.abort);
  const toast = useStore((state) => state.toast);

  const [text, setText] = useState('');
  const [authorNote, setAuthorNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [overrides, setOverrides] = useState<NonNullable<ChatRequest['overrides']>>({});
  const [overridesDirty, setOverridesDirty] = useState(false);

  const area = useRef<HTMLTextAreaElement | null>(null);
  const noteArea = useRef<HTMLTextAreaElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);

  const story = bundle?.story ?? null;
  const scene = activeScene();
  const busy = streaming.active;
  const note = noteOpen ? authorNote.trim() : '';

  /** Unset fields inherit the story; an empty note is not an override at all. */
  const turnOverrides = useMemo<NonNullable<ChatRequest['overrides']> | undefined>(() => {
    const merged: NonNullable<ChatRequest['overrides']> = { ...overrides };
    if (note) merged.authorNote = note;
    return Object.keys(merged).length > 0 ? merged : undefined;
  }, [overrides, note]);

  /* The meter measures the payload the next turn would actually send. */
  useEffect(() => {
    if (!story) return;
    schedulePlan(
      {
        storyId: story.id,
        sceneId: scene?.id ?? '',
        mode: text.trim() ? 'send' : 'continue',
        text: '',
        ...(turnOverrides ? { overrides: turnOverrides } : {}),
      },
      text.length > 0 ? 480 : 320,
    );
  }, [story, scene, text, turnOverrides, schedulePlan]);

  /* Grow with the content, capped so the transcript keeps most of the screen. */
  const resize = (): void => {
    const node = area.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(220, Math.max(52, node.scrollHeight))}px`;
  };

  useEffect(resize, [text]);

  useEffect(() => {
    if (!overridesOpen && !noteOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (popover.current?.contains(event.target as Node)) return;
      setOverridesOpen(false);
      setNoteOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOverridesOpen(false);
        setNoteOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [overridesOpen, noteOpen]);

  const send = async (): Promise<void> => {
    if (!story || !scene) return;
    const body = text.trim();
    if (!body) {
      toast({ kind: 'info', title: 'Nothing to send', detail: 'Write a paragraph, or use Continue for the next beat.' });
      area.current?.focus();
      return;
    }
    setText('');
    await runTurn({
      storyId: story.id,
      sceneId: scene.id,
      mode: 'send',
      text: body,
      ...(turnOverrides ? { overrides: turnOverrides } : {}),
    });
    if (note) setAuthorNote('');
    area.current?.focus();
  };

  const safety = cacheSafetySentence(plan);
  const words = countWords(text);
  const overrideCount = Object.keys(overrides).length + (noteOpen && authorNote.trim() ? 1 : 0);

  const safetyTone =
    safety?.level === 'danger' ? 'var(--danger)' : safety?.level === 'warn' ? 'var(--warn)' : 'var(--ok)';

  return (
    <section
      className="shrink-0 border-t border-border pb-safe"
      style={{ background: 'var(--panel)' }}
      aria-label="Composer"
    >
      {/* The same measure as the transcript's column, so the composer's edge and
          the prose's edge are one line. They were 48rem against 52rem, which put
          the writing surface 16px inside the text it was writing. */}
      <div className="mx-auto w-full max-w-[52rem] px-3 pt-2.5 pb-3 sm:px-6">
        {/* The speaker, and the one sentence about the cache that is worth
            reading while writing: what the last edit did to the prefix. There
            used to be a cost pill here too; its numbers live in Turn details and
            the payload report, where they are read deliberately. The row wraps
            rather than squeezes: on a 320px phone the persona chip would
            otherwise be compressed under its own label. */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <PersonaSwitch />
          {safety ? (
            <span
              className="hidden min-w-0 items-center gap-1.5 truncate text-[11px] sm:flex"
              style={{ color: safetyTone }}
              title={safety.text}
            >
              {safety.level === 'safe' ? <IconFeather size={11} /> : <IconAlert size={11} />}
              <span className="truncate">{safety.text}</span>
            </span>
          ) : null}
        </div>

        {/* The cache-safety sentence on a phone, where the row cannot carry it. */}
        {safety ? (
          <p className="mb-2 flex items-start gap-1.5 text-[11.5px] leading-snug sm:hidden" style={{ color: safetyTone }}>
            <span className="mt-px shrink-0">
              {safety.level === 'safe' ? <IconFeather size={12} /> : <IconAlert size={12} />}
            </span>
            <span>{safety.text}</span>
          </p>
        ) : null}

        <div className="relative" ref={popover}>
          {noteOpen ? (
            <div
              className="animate-rise mb-2 rounded-lg border border-border p-2.5"
              style={{ background: 'var(--bg-sunken)', borderLeftWidth: 2, borderLeftColor: 'var(--accent)' }}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="eyebrow eyebrow-accent">Author note</span>
                <span className="text-[10.5px] text-faint">
                  mid-conversation steering · lives in the volatile tail, so it invalidates only itself
                </span>
                <button
                  type="button"
                  className="icon-btn ml-auto"
                  onClick={() => {
                    setNoteOpen(false);
                    setAuthorNote('');
                  }}
                  aria-label="Remove the author note"
                >
                  <IconClose size={11} />
                </button>
              </div>
              <label className="sr-only" htmlFor="author-note">
                Author note
              </label>
              <textarea
                id="author-note"
                ref={noteArea}
                className="field resize-none text-[12.5px]"
                rows={2}
                value={authorNote}
                placeholder="Steer the next turn: “keep the pace slow”, “Let Mira lie about the ledger”."
                onChange={(event) => setAuthorNote(event.target.value)}
              />
            </div>
          ) : null}

          <div
            className="flex items-end gap-2 rounded-xl border p-2 transition-colors"
            style={{
              background: 'var(--bg-sunken)',
              borderColor: busy ? 'color-mix(in oklab, var(--accent) 45%, var(--border))' : 'var(--border)',
              boxShadow: 'var(--shadow-1)',
            }}
          >
            <label className="sr-only" htmlFor="composer-input">
              Write your turn
            </label>
            <textarea
              id="composer-input"
              ref={area}
              className="max-h-[220px] min-h-[52px] flex-1 resize-none bg-transparent px-1.5 py-1.5 font-serif text-[15px] leading-[1.65] outline-none"
              rows={2}
              value={text}
              placeholder={busy ? 'Streaming — press Stop to cut it off.' : 'Write your turn. Enter to send, Shift+Enter for a new line.'}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // IME safety: a composition Enter commits a candidate, never sends.
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={`icon-btn hidden sm:inline-flex ${noteOpen ? 'icon-btn-on' : ''}`}
                onClick={() => {
                  setNoteOpen((value) => !value);
                  setOverridesOpen(false);
                  window.setTimeout(() => noteArea.current?.focus(), 0);
                }}
                aria-pressed={noteOpen}
                aria-label="Author note — mid-conversation steering"
                title="Author note — steering that lives in the volatile tail"
              >
                <IconNote size={14} />
              </button>

              <button
                type="button"
                className={`icon-btn ${overridesDirty ? 'icon-btn-on' : ''}`}
                onClick={() => {
                  setOverridesOpen((value) => !value);
                  setNoteOpen(false);
                }}
                aria-expanded={overridesOpen}
                aria-label="This turn's overrides"
                title="Model, effort, sampling and budgets for this turn only"
              >
                <IconSettings size={14} />
                {overrideCount > 0 ? <span className="num ml-0.5 text-[9px]">{overrideCount}</span> : null}
              </button>

              {busy ? (
                <button type="button" className="btn btn-danger h-[34px]" onClick={abort} aria-label="Stop generating">
                  <IconStop size={12} />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary h-[34px]"
                  onClick={() => void send()}
                  disabled={!text.trim()}
                  aria-label="Send your turn"
                >
                  <IconSend size={13} />
                  Send
                </button>
              )}
            </div>
          </div>

          {overridesOpen ? (
            <Overrides
              overrides={overrides}
              story={story}
              onChange={(next) => {
                setOverrides(next);
                setOverridesDirty(true);
              }}
              onReset={() => {
                setOverrides({});
                setOverridesDirty(false);
              }}
            />
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
          {text.length > 0 ? (
            <span className="num">
              {words} word{words === 1 ? '' : 's'} · {text.length} chars
            </span>
          ) : (
            <span className="hidden sm:inline">Enter sends · Shift+Enter breaks the line</span>
          )}
          {story ? (
            <span className="num ml-auto">
              {MODELS[story.model].label} · {EFFORT_LABELS[story.effort].split(' ')[0]}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- overrides */

type OverridesProps = {
  overrides: NonNullable<ChatRequest['overrides']>;
  story: { model: ModelId; effort: ReasoningEffort; temperature: number; topP: number; maxTokens: number; targetWords: number; prefill: string } | null;
  onChange: (next: NonNullable<ChatRequest['overrides']>) => void;
  onReset: () => void;
};

/**
 * Per-turn overrides. Every field is opt-in: an untouched field inherits the
 * story's value, which is the whole point — a prefix only survives if the
 * numbers that feed it stop moving.
 */
function Overrides({ overrides, story, onChange, onReset }: OverridesProps) {
  const set = <K extends keyof NonNullable<ChatRequest['overrides']>>(
    key: K,
    value: NonNullable<ChatRequest['overrides']>[K],
  ): void => {
    const next = { ...overrides };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const number = (key: 'temperature' | 'topP' | 'maxTokens' | 'targetWords', value: string, min: number, max: number, step: number) => {
    if (value === '') {
      set(key, undefined);
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    set(key, Math.min(max, Math.max(min, parsed)) as never);
  };

  /* What an untouched field will actually send. The placeholder used to say
     "Story default" and nothing else, which meant the popover never told the writer
     what the story was set to — the one fact the control exists to disclose. */
  const inherited = story
    ? {
        effort: EFFORT_LABELS[story.effort].replace(/\s*\(default\)$/, ''),
        model: MODELS[story.model].label.replace('DeepSeek ', ''),
      }
    : null;

  return (
    <div
      className="animate-rise absolute right-0 bottom-full z-30 mb-2 w-[min(94vw,26rem)] max-h-[min(80dvh,44rem)] overflow-y-auto rounded-xl border border-border p-3"
      style={{ background: 'var(--panel-raised)', boxShadow: 'var(--shadow-3)' }}
      role="group"
      aria-label="Overrides for this turn"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="eyebrow eyebrow-accent">This turn only</span>
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-faint">
          {inherited ? `unset fields inherit the story — ${inherited.effort}, ${inherited.model}` : 'unset fields inherit the story'}
        </span>
        <button type="button" className="btn btn-ghost ml-auto shrink-0" style={{ padding: '0.2rem 0.4rem' }} onClick={onReset}>
          Reset
        </button>
      </div>

      {/* The prompt is not a per-turn override — it is what the conversation *is* —
          but this popover is where the writer already is when they want to change
          the model or the voice, and the two decisions belong in one place. It sits
          above the turn-scoped controls and says so. */}
      <div className="mb-3">
        <PromptPicker />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <label className="label" htmlFor="ov-model">
            Model
          </label>
          <select
            id="ov-model"
            className="field field-sm"
            value={overrides.model ?? ''}
            onChange={(event) => set('model', (event.target.value || undefined) as ModelId | undefined)}
          >
            <option value="">
              {story ? `Story default — ${MODELS[story.model].label}` : 'Story default'}
            </option>
            {(Object.keys(MODELS) as ModelId[]).map((model) => (
              <option key={model} value={model}>
                {MODELS[model].label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="ov-effort">
            Reasoning effort
          </label>
          <select
            id="ov-effort"
            className="field field-sm"
            value={overrides.effort ?? ''}
            onChange={(event) => set('effort', (event.target.value || undefined) as ReasoningEffort | undefined)}
          >
            <option value="">{story ? `Story default — ${EFFORT_LABELS[story.effort].replace(/\s*\(default\)$/, '')}` : 'Story default'}</option>
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {EFFORT_LABELS[effort]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10.5px] leading-snug text-faint">
            Off is the only setting that honours <span className="num">temperature</span>. Anything else turns thinking
            on, and the reasoning tokens bill as output.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="ov-words">
            Target words
          </label>
          <input
            id="ov-words"
            className="field field-sm num"
            type="number"
            min={60}
            max={4000}
            step={20}
            placeholder={story ? String(story.targetWords) : '300'}
            value={overrides.targetWords ?? ''}
            onChange={(event) => number('targetWords', event.target.value, 40, 8_000, 20)}
          />
        </div>

        <div>
          <label className="label" htmlFor="ov-temp">
            Temperature
          </label>
          <input
            id="ov-temp"
            className="field field-sm num"
            type="number"
            min={0}
            max={2}
            step={0.05}
            placeholder={story ? String(story.temperature) : '1'}
            value={overrides.temperature ?? ''}
            onChange={(event) => number('temperature', event.target.value, 0, 2, 0.05)}
          />
        </div>

        <div>
          <label className="label" htmlFor="ov-topp">
            Top P
          </label>
          <input
            id="ov-topp"
            className="field field-sm num"
            type="number"
            min={0.01}
            max={1}
            step={0.01}
            placeholder={story ? String(story.topP) : '1'}
            value={overrides.topP ?? ''}
            onChange={(event) => number('topP', event.target.value, 0.01, 1, 0.01)}
          />
        </div>

        <div>
          <label className="label" htmlFor="ov-max">
            Max output tokens
          </label>
          <input
            id="ov-max"
            className="field field-sm num"
            type="number"
            min={64}
            max={32_000}
            step={64}
            placeholder={story ? String(story.maxTokens) : '1200'}
            value={overrides.maxTokens ?? ''}
            onChange={(event) => number('maxTokens', event.target.value, 32, 64_000, 64)}
          />
        </div>

        <div>
          <label className="label" htmlFor="ov-prefill">
            Prefill
          </label>
          <input
            id="ov-prefill"
            className="field field-sm"
            placeholder={story?.prefill ? story.prefill.slice(0, 24) : 'none'}
            value={overrides.prefill ?? ''}
            onChange={(event) => set('prefill', event.target.value || undefined)}
          />
        </div>

        <div className="col-span-2">
          <div className="eyebrow mb-1.5">Side-channel passes for this turn</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Toggle
              id="ov-director"
              label="Director"
              hint="notes after the turn"
              checked={overrides.director ?? false}
              onChange={(value) => set('director', value)}
            />
            <Toggle
              id="ov-archivist"
              label="Archivist"
              hint="distil memories"
              checked={overrides.archivist ?? false}
              onChange={(value) => set('archivist', value)}
            />
            <Toggle
              id="ov-recall"
              label="Recall"
              hint="inject memories"
              checked={overrides.recall !== false}
              onChange={(value) => set('recall', value)}
            />
            <Toggle
              id="ov-conductor"
              label="Conductor"
              hint="draft variants, judge picks"
              checked={overrides.conductor ?? false}
              onChange={(value) => set('conductor', value)}
            />
            <Toggle
              id="ov-tools"
              label="Inline tools"
              hint="runs with thinking on"
              checked={overrides.includeTools ?? false}
              onChange={(value) => set('includeTools', value)}
            />
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
            These run in their own short-lived contexts. None of them touches the narration payload, which is exactly
            why the narrator's prefix stays warm.
          </p>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        id={id}
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={`${label} — ${hint}`}
        onClick={() => onChange(!checked)}
      />
      <label htmlFor={id} className="cursor-pointer text-[11.5px]" onClick={() => onChange(!checked)}>
        {label}
        <span className="ml-1 text-[10px] text-faint">{hint}</span>
      </label>
    </span>
  );
}

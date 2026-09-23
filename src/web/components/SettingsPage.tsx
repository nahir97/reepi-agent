/**
 * Settings: the orderly place for everything that is not writing.
 *
 * The rail's studio list had seven rows — Cast, Creation assistant, Cost & cache,
 * Story settings, Prompt templates, Import & export, Duplicate — all at the same
 * level as the library. That is a concatenation, not a hierarchy: a writer
 * scanning it for "where do I change the model" learns nothing from the row order,
 * and four of the seven are things they will touch twice a year.
 *
 * This page is the hierarchy. It is a directory of grouped rows, each one either
 * opening a dialog that already exists or navigating to a page that already
 * exists. **No dialog is re-implemented here and no new dialog is created** — the
 * value is the filing, not a second copy of the UI.
 *
 * One rule keeps it honest: a row whose subject does not exist is *omitted*, never
 * rendered disabled. A disabled control with no way to become enabled is exactly
 * what made the old flat list feel like clutter; "no story is open" is stated
 * once, in the band, rather than six times down the page.
 */

import type { ReactNode, ReactElement } from 'react';
import { useStore } from '../store.ts';
import { THEME_DOT, THEME_LABEL, THEME_ORDER } from '../theme.ts';
import { PageBand } from './panel.tsx';
import {
  IconBook,
  IconChart,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconGauge,
  IconPen,
  IconTemplate,
  IconTrash,
  IconUsers,
  IconWand,
  IconWarm,
} from './icons.tsx';

type Row = {
  id: string;
  label: string;
  hint: string;
  icon: (props: { size?: number }) => ReactElement;
  run: () => void;
  /** Rendered in the danger tone, for the one destructive row. */
  danger?: boolean;
};

export function SettingsPage() {
  const bundle = useStore((state) => state.bundle);
  const account = useStore((state) => state.account);
  const templates = useStore((state) => state.promptTemplates);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const setPage = useStore((state) => state.setPage);
  const openDialog = useStore((state) => state.openDialog);
  const runDiagnose = useStore((state) => state.runDiagnose);
  const runWarm = useStore((state) => state.runWarm);
  const duplicateStory = useStore((state) => state.duplicateStory);
  const archiveStory = useStore((state) => state.archiveStory);

  const story = bundle?.story ?? null;

  const storyRows: Row[] = story
    ? [
        {
          id: 'prompt-settings',
          label: 'Prompt settings',
          hint: 'every block, with its token count and volatility',
          icon: IconPen,
          run: () => openDialog({ kind: 'story-settings' }),
        },
        {
          id: 'duplicate',
          label: 'Duplicate story',
          hint: 'keep this prefix, write a new branch',
          icon: IconCopy,
          run: () => void duplicateStory(story.id),
        },
        {
          id: 'delete',
          label: 'Delete story',
          hint: 'characters and conversations are kept',
          icon: IconTrash,
          danger: true,
          run: () => archiveStory(story.id),
        },
      ]
    : [];

  const contentRows: Row[] = [
    {
      id: 'characters',
      label: 'Characters & personas',
      hint: 'your library, and who you are',
      icon: IconUsers,
      run: () => setPage('characters'),
    },
    {
      id: 'assistant',
      label: 'Creation assistant',
      hint: 'its own chat — builds characters, lore, worlds and templates',
      icon: IconWand,
      run: () => setPage('creator'),
    },
  ];

  const studioRows: Row[] = [
    {
      id: 'templates',
      label: 'Prompt templates',
      hint: `${templates.length} reusable prompt${templates.length === 1 ? '' : 's'}, with macros`,
      icon: IconTemplate,
      run: () => openDialog({ kind: 'prompt-templates' }),
    },
    {
      id: 'transfer',
      label: 'Import & export',
      hint: 'cards, bundles, markdown',
      icon: IconDownload,
      run: () => openDialog({ kind: 'import-export' }),
    },
  ];

  const costRows: Row[] = [
    {
      id: 'ledger',
      label: 'Cost & cache',
      hint: 'spend, savings, hit rate and the peak clock',
      icon: IconChart,
      run: () => openDialog({ kind: 'insights' }),
    },
    {
      id: 'diagnose',
      label: 'Diagnose',
      hint: 'key, payload order, cache smoke test',
      icon: IconGauge,
      run: () => void runDiagnose(),
    },
    ...(story
      ? [
          {
            id: 'warm',
            label: 'Warm the cache',
            hint: 'pay one deliberate miss so every turn after it hits',
            icon: IconWarm,
            run: () => void runWarm(),
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <PageBand
        title="Settings"
        hint={
          story
            ? `“${story.title}” is open — its own settings are at the top`
            : 'No story is open — story settings appear here once one is'
        }
        onBack={() => setPage(bundle ? 'story' : 'discover')}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[52rem] px-4 py-4">
          {storyRows.length > 0 ? (
            <Section title="This story" hint={story?.title}>
              {storyRows.map((row) => (
                <SettingsRow key={row.id} row={row} />
              ))}
            </Section>
          ) : null}

          <Section title="Content">
            {contentRows.map((row) => (
              <SettingsRow key={row.id} row={row} />
            ))}
          </Section>

          <Section title="Studio">
            {/* The theme is a row of swatches rather than a destination: four
                values, all of them visible, and the choice is the whole setting.
                A swatch previews a theme you are not in, which is why the
                gradients are literals in `theme.ts` rather than `var(--accent)`. */}
            <div className="flex items-center gap-2 rounded-md px-2 py-2">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-dim"
                aria-hidden="true"
              >
                <IconBook size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">Studio theme</span>
                <span className="block truncate text-[10.5px] text-faint">the whole studio, remembered</span>
              </span>
              <span className="flex shrink-0 items-center gap-1" role="group" aria-label="Studio theme">
                {THEME_ORDER.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="h-7 w-7 rounded-md border"
                    style={{
                      borderColor: theme === option ? 'var(--accent)' : 'var(--border)',
                      boxShadow: theme === option ? 'inset 0 0 0 1px var(--accent)' : undefined,
                      background: THEME_DOT[option],
                    }}
                    onClick={() => setTheme(option)}
                    aria-pressed={theme === option}
                    aria-label={`${THEME_LABEL[option]} theme`}
                    title={`${THEME_LABEL[option]} — the whole studio`}
                  />
                ))}
              </span>
            </div>
            {studioRows.map((row) => (
              <SettingsRow key={row.id} row={row} />
            ))}
          </Section>

          <Section title="Cost & cache">
            {costRows.map((row) => (
              <SettingsRow key={row.id} row={row} />
            ))}
            <p className="px-2 pt-2 text-[11px] leading-snug text-faint">
              {account
                ? account.keyPresent
                  ? account.balanceUsd === null
                    ? 'A DeepSeek key is set. The balance could not be read.'
                    : `DeepSeek balance ${account.balanceUsd.toFixed(2)} USD · ${account.models.length} model${
                        account.models.length === 1 ? '' : 's'
                      } available.`
                  : 'No DeepSeek key is set, so nothing can be written yet.'
                : 'Reading the account…'}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-1.5 flex items-baseline gap-2 px-2">
        <span className="eyebrow">{title}</span>
        {hint ? <span className="min-w-0 truncate text-[10.5px] text-faint">{hint}</span> : null}
      </div>
      <div className="rounded-lg border border-border" style={{ background: 'var(--panel-raised)' }}>
        {children}
      </div>
    </section>
  );
}

function SettingsRow({ row }: { row: Row }) {
  const Icon = row.icon;
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2.5 border-b border-border px-2 py-2.5 text-left last:border-b-0 transition-colors hover:bg-[var(--accent-soft)]"
      onClick={row.run}
      style={row.danger ? { color: 'var(--danger)' } : undefined}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border"
        style={{ color: row.danger ? 'var(--danger)' : 'var(--text-dim)' }}
        aria-hidden="true"
      >
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{row.label}</span>
        <span className="block truncate text-[10.5px] text-faint">{row.hint}</span>
      </span>
      <span className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true">
        <IconChevronRight size={12} />
      </span>
    </button>
  );
}

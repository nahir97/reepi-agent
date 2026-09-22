import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, openDatabase } from './db.ts';
import { personas, scenes } from './store/index.ts';
import { fetchBalance, fetchModels } from './deepseek.ts';
import { readCalibration } from './orchestrator.ts';
import { runDiagnose } from './agents.ts';
import { fail } from './http.ts';
import {
  BLOCK_LABELS,
  BLOCK_ORDER,
  BLOCK_VOLATILITY,
  EFFORT_LABELS,
  MODELS,
  PRICING_OFF_PEAK,
  PRICING_PEAK,
} from '../shared/types.ts';
import { cacheMultiplier, isPeak, msUntilOffPeak } from '../shared/cost.ts';
import { TEMPLATES } from '../shared/api.ts';

import chatRoutes from './routes/chat.ts';
import agenticRoutes from './routes/agentic.ts';
import creatorRoutes from './routes/creator.ts';
import libraryRoutes from './routes/library.ts';
import memoryRoutes from './routes/memory.ts';
import portabilityRoutes from './routes/portability.ts';
import insightsRoutes from './routes/insights.ts';
import templateRoutes from './routes/templates.ts';

/**
 * Reepi server.
 *
 * Serves the JSON API under `/api` and, in production, the built SPA from
 * `dist/`. In development Vite serves the UI on :5273 and proxies `/api` here.
 */

const PORT = Number(process.env.REEPI_PORT ?? 8787);
const HOST = process.env.REEPI_HOST ?? '127.0.0.1';
const DB_PATH = process.env.REEPI_DB ?? 'data/reepi.sqlite';
const VERSION = '1.0.0';

openDatabase(DB_PATH);

const app = new Hono();

app.onError((error, c) => {
  console.error('[reepi] unhandled', error);
  return fail(c, 500, 'Internal error', error instanceof Error ? error.message : String(error));
});

/* -------------------------------------------------------------- meta */

app.get('/api/health', (c) =>
  c.json({ ok: true, version: VERSION, keyPresent: Boolean(process.env.DEEPSEEK_API_KEY) }),
);

app.get('/api/meta', async (c) => {
  const available = await fetchModels().catch(() => [] as string[]);
  return c.json({
    version: VERSION,
    models: MODELS,
    efforts: EFFORT_LABELS,
    blocks: BLOCK_ORDER.map((kind) => ({
      kind,
      label: BLOCK_LABELS[kind],
      volatility: BLOCK_VOLATILITY[kind],
    })),
    templates: TEMPLATES,
    themes: ['ink', 'ember', 'verdant', 'daylight'] as const,
    pricing: { offPeak: PRICING_OFF_PEAK, peak: PRICING_PEAK },
    peak: isPeak(),
    msUntilOffPeak: msUntilOffPeak(),
    cacheMultiplier: cacheMultiplier('deepseek-flash', isPeak()),
    availableModels: available,
    calibration: readCalibration(),
  });
});

/**
 * Account state. GET and POST are both supported because some clients will not
 * send a body-less POST, and this is the natural "refresh my balance" action.
 */
async function accountPayload() {
  const keyPresent = Boolean(process.env.DEEPSEEK_API_KEY);
  const [balance, models] = keyPresent
    ? await Promise.all([fetchBalance(), fetchModels()])
    : [null, [] as string[]];
  return {
    keyPresent,
    balanceUsd: balance?.usd ?? null,
    available: balance?.available ?? false,
    models,
    calibration: readCalibration(),
  };
}

app.get('/api/account', async (c) => c.json(await accountPayload()));
app.post('/api/account', async (c) => c.json(await accountPayload()));

app.get('/api/diagnose', async (c) => {
  const storyId = c.req.query('storyId') ?? null;
  return c.json(await runDiagnose(storyId));
});

/* ----------------------------------------------------------- modules */

app.route('/api', chatRoutes);
app.route('/api', agenticRoutes);
app.route('/api', creatorRoutes);
app.route('/api', libraryRoutes);
app.route('/api', memoryRoutes);
app.route('/api', portabilityRoutes);
app.route('/api', insightsRoutes);
app.route('/api', templateRoutes);

/* ------------------------------------------------------------ static */

const DIST = join(import.meta.dirname, '../../dist');
app.use('/*', serveStatic({ root: DIST }));
// SPA fallback: any non-API path serves the shell so deep links work.
app.get('*', serveStatic({ path: join(DIST, 'index.html') }));

/**
 * Boot repair. The library routes create a scene and persona with every new
 * story, but stories created before that behaviour existed (or imported by hand
 * into the database) could open onto an unusable editor. Cheap to check, and it
 * runs once.
 *
 * A character chat is skipped for the persona half: it owns no personas, it
 * borrows its pool from the story the card lives in, so minting one here would
 * create an orphan row nothing ever reads. It still gets a scene if one is
 * missing — a chat is a normal story in every other respect.
 */
function repairStories(): void {
  const rows = getDb().prepare('SELECT id, character_id FROM stories').all() as {
    id: string;
    character_id: string | null;
  }[];
  for (const row of rows) {
    if (scenes.list(row.id).length === 0) {
      scenes.create(row.id, { title: 'Opening' });
      console.log(`[reepi] added a missing opening scene to story ${row.id}`);
    }
    if (!row.character_id && personas.list(row.id).length === 0) {
      personas.create(row.id, { name: 'You', isDefault: true });
    }
  }
}

repairStories();

/**
 * Is the static UI this port serves older than the source it was built from?
 *
 * `npm run dev` starts *this* server, which also serves `dist/` — so opening :8787
 * during development shows whatever was last built, not what is in `src/`. That is
 * a silent trap: the app works, and the feature you just wrote is simply not there.
 * `npm run dev:web` is the live UI, and nothing said so.
 *
 * One walk of `src/` at boot, and the answer is a line in the terminal instead of
 * half an hour of looking for a surface that exists.
 */
function uiBuildStatus(): 'missing' | 'stale' | 'fresh' {
  const index = join(DIST, 'index.html');
  if (!existsSync(index)) return 'missing';
  try {
    const root = join(import.meta.dirname, '../..');
    let newest = statSync(join(root, 'index.html')).mtimeMs;
    for (const relative of readdirSync(join(root, 'src'), { recursive: true })) {
      const file = join(root, 'src', String(relative));
      if (statSync(file).isFile()) newest = Math.max(newest, statSync(file).mtimeMs);
    }
    return newest > statSync(index).mtimeMs ? 'stale' : 'fresh';
  } catch {
    /* Best effort by construction: a deployment that ships `dist/` without `src/`
       (or a file that vanishes mid-walk) must not turn a diagnostic into a boot
       failure. No source to compare means no claim to make. */
    return 'fresh';
  }
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[reepi] api      http://${HOST}:${info.port}`);
  console.log(`[reepi] database ${DB_PATH}`);
  console.log(
    `[reepi] billing  ${
      isPeak()
        ? `PEAK (2x) — off-peak in ${Math.round(msUntilOffPeak() / 60_000)}m`
        : 'off-peak (half price)'
    }`,
  );
  /* Said out loud because the failure is silent: the UI loads, and the thing you
     just wrote is missing from it. */
  const ui = uiBuildStatus();
  if (ui === 'missing') {
    console.warn(
      `[reepi] no UI build at ${DIST} — this port serves the API only. Run \`npm run build\`, or use \`npm run dev:web\` for the live UI on :5273.`,
    );
  } else if (ui === 'stale') {
    console.warn(
      '[reepi] dist/ is OLDER than src/ — this port is serving a stale UI. Run `npm run build`, or use `npm run dev:web` for the live UI on :5273.',
    );
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('[reepi] DEEPSEEK_API_KEY is not set — chat requests will fail.');
  }
});

export default app;

// Leaderboard sources. Every adapter is deterministic — fixed URLs, fixed
// parsing rules, no model in the loop — and reports what it found, including
// board names it could not match to a catalog model (so you can add aliases).
//
// `fetch` is injected so tests run on fixtures and Workers can pass their own.

import { aliasIndex, normalizeModelName } from '../matrix.ts';
import type { ModelRow, Score } from '../types.ts';

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface SourceResult {
  id: string;
  ok: boolean;
  scores: Score[];
  rows: number;
  unmatched: string[];
  error?: string;
}

export interface Source {
  id: string;
  /** Benchmarks this source fills. */
  benchmarks: string[];
  fetch(fetcher: Fetcher, models: readonly ModelRow[], today: string): Promise<SourceResult>;
}

/** Raw (name, value) rows → one Score per catalog model. */
export function toScores(
  rows: Array<{ name: string; value: number; date?: string }>,
  benchmark: string,
  models: readonly ModelRow[],
  opts: { source: string; today: string; aggregate: 'max' | 'median'; vendorReported?: boolean },
): { scores: Score[]; unmatched: string[] } {
  const idx = aliasIndex(models);
  const grouped = new Map<string, { values: number[]; date: string }>();
  const unmatched: string[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.value)) continue;
    const id = idx.get(normalizeModelName(r.name));
    if (!id) { if (unmatched.length < 15 && !unmatched.includes(r.name)) unmatched.push(r.name); continue; }
    const g = grouped.get(id) || { values: [], date: r.date || opts.today };
    g.values.push(r.value);
    if (r.date && r.date > g.date) g.date = r.date;
    grouped.set(id, g);
  }
  const scores: Score[] = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([model, g]) => {
    const v = [...g.values].sort((a, b) => a - b);
    const value = opts.aggregate === 'max' ? v[v.length - 1] : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    return { model, benchmark, value: Math.round(value * 100) / 100, source: opts.source, asOf: g.date, ...(opts.vendorReported ? { vendorReported: true } : {}) };
  });
  return { scores, unmatched };
}

// ── LMArena (arena.ai) via its official Hugging Face dataset ───────────────

const ARENA_DATASET = 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main';

/** benchmark id → [dataset config, category]. */
export const ARENA_MAP: Record<string, [string, string]> = {
  'arena-webdev': ['webdev', 'overall'],
  'arena-agent': ['agent', 'overall'],
  'arena-coding': ['text_style_control', 'coding'],
  'arena-expert': ['text_style_control', 'expert'],
  'arena-hard': ['text_style_control', 'hard_prompts'],
  'arena-math': ['text_style_control', 'math'],
  'arena-creative': ['text_style_control', 'creative_writing'],
  'arena-legal': ['text_style_control', 'industry_legal_and_government'],
  'arena-medicine': ['text_style_control', 'industry_medicine_and_healthcare'],
  'arena-science': ['text_style_control', 'industry_life_and_physical_and_social_science'],
  'arena-business': ['text_style_control', 'industry_business_and_management_and_financial_operations'],
  'arena-writing': ['text_style_control', 'industry_writing_and_literature_and_language'],
  'arena-software': ['text_style_control', 'industry_software_and_it_services'],
  'arena-instruct': ['text_style_control', 'instruction_following'],
  'arena-text': ['text_style_control', 'overall'],
  'arena-search': ['search_style_control', 'overall'],
  'arena-document': ['document_style_control', 'overall'],
  'arena-vision': ['vision_style_control', 'overall'],
  'arena-t2i': ['text_to_image', 'overall'],
};

/** Text/webdev/image arenas publish `rating` (Bradley–Terry); the Agent Arena publishes `score` (a share). */
export interface ArenaRow { model_name: string; rating?: number; score?: number; category: string; leaderboard_publish_date?: string }

const arenaValue = (x: ArenaRow) => Number(x.rating ?? x.score);

/** Parquet bytes → rows. hyparquet is an optional dependency, loaded only here. */
async function readParquet(buf: ArrayBuffer): Promise<ArenaRow[]> {
  const { parquetReadObjects } = await import('hyparquet');
  // No column projection: the arenas name their value column differently.
  const rows = (await parquetReadObjects({ file: buf })) as any[];
  return rows.map((r) => ({ model_name: String(r.model_name), rating: r.rating == null ? undefined : Number(r.rating), score: r.score == null ? undefined : Number(r.score), category: String(r.category), leaderboard_publish_date: r.leaderboard_publish_date ? String(r.leaderboard_publish_date) : undefined }));
}

export function arenaScores(rowsByConfig: Map<string, ArenaRow[]>, models: readonly ModelRow[], today: string): SourceResult {
  const scores: Score[] = [];
  const unmatched = new Set<string>();
  let rows = 0;
  for (const [bench, [config, category]] of Object.entries(ARENA_MAP)) {
    const r = (rowsByConfig.get(config) || []).filter((x) => x.category === category);
    rows += r.length;
    const out = toScores(
      r.map((x) => ({ name: x.model_name, value: arenaValue(x), date: x.leaderboard_publish_date || undefined })),
      bench, models, { source: `${ARENA_DATASET.replace('/resolve/main', '')} (${config}/${category})`, today, aggregate: 'max' },
    );
    scores.push(...out.scores);
    // Only report unmatched names from the top of each board — those are the ones worth an alias.
    for (const n of [...r].sort((a, b) => arenaValue(b) - arenaValue(a)).slice(0, 12).map((x) => x.model_name)) {
      if (out.unmatched.includes(n)) unmatched.add(n);
    }
  }
  return { id: 'arena', ok: scores.length > 0, scores, rows, unmatched: [...unmatched].slice(0, 25) };
}

export const arenaSource: Source = {
  id: 'arena',
  benchmarks: Object.keys(ARENA_MAP),
  async fetch(fetcher, models, today) {
    const configs = [...new Set(Object.values(ARENA_MAP).map(([c]) => c))].sort();
    const byConfig = new Map<string, ArenaRow[]>();
    const errors: string[] = [];
    for (const config of configs) {
      try {
        const res = await fetcher(`${ARENA_DATASET}/${config}/latest-00000-of-00001.parquet`);
        if (!res.ok) { errors.push(`${config}: HTTP ${res.status}`); continue; }
        byConfig.set(config, await readParquet(await res.arrayBuffer()));
      } catch (e: any) {
        errors.push(`${config}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    const r = arenaScores(byConfig, models, today);
    return errors.length ? { ...r, ok: r.ok, error: errors.join('; ') } : r;
  },
};

// ── Codesota (leaderboard pages, server-rendered HTML) ─────────────────────

/** HTML → text cells, the way the page reads. */
export function htmlCells(html: string): string[] {
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  return t.split(/<[^>]+>/).map((c) => decodeEntities(c).trim()).filter(Boolean);
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/**
 * Codesota leaderboard rows read as: rank · model · [API|Open…] · org · "Mon YYYY" · source · score.
 * Anchor on the "Mon YYYY" date cell: model is the first non-rank cell after
 * the rank, score is the first number after the source.
 */
export function parseCodesota(html: string): Array<{ name: string; value: number; date: string; source: string }> {
  const cells = htmlCells(html);
  const out: Array<{ name: string; value: number; date: string; source: string }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < cells.length; i++) {
    if (!/^\d{2}$/.test(cells[i])) continue;
    // find the date within the next 6 cells
    let d = -1;
    for (let j = i + 2; j < Math.min(cells.length, i + 7); j++) if (/^[A-Z][a-z]{2} \d{4}$/.test(cells[j])) { d = j; break; }
    if (d < 0) continue;
    const name = cells[i + 1];
    const source = cells[d + 1] || '';
    const num = cells[d + 2];
    if (!name || /^\d+$/.test(name) || !/^\d+(\.\d+)?$/.test(num || '')) continue;
    const key = `${cells[i]}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [mon, yr] = cells[d].split(' ');
    out.push({ name, value: Number(num), date: `${yr}-${MONTHS[mon] || '01'}-01`, source });
    i = d + 2;
  }
  return out;
}

export const CODESOTA_PAGES: Array<{ benchmark: string; url: string; aggregate: 'max' | 'median'; vendorReported: boolean }> = [
  // agent+model pairs: the median across agents is the fairer model signal.
  { benchmark: 'terminal-bench-2', url: 'https://www.codesota.com/browse/agentic/autonomous-coding/terminal-bench-2', aggregate: 'median', vendorReported: false },
  { benchmark: 'swe-bench-verified', url: 'https://www.codesota.com/browse/agentic/swe-bench/swe-bench-verified-agentic', aggregate: 'max', vendorReported: true },
  { benchmark: 'gpqa', url: 'https://www.codesota.com/browse/reasoning/multi-step-reasoning/gpqa', aggregate: 'max', vendorReported: true },
];

export const codesotaSource: Source = {
  id: 'codesota',
  benchmarks: CODESOTA_PAGES.map((p) => p.benchmark),
  async fetch(fetcher, models, today) {
    const scores: Score[] = [];
    const unmatched: string[] = [];
    const errors: string[] = [];
    let rows = 0;
    for (const p of CODESOTA_PAGES) {
      try {
        const res = await fetcher(p.url);
        if (!res.ok) { errors.push(`${p.benchmark}: HTTP ${res.status}`); continue; }
        const parsed = parseCodesota(await res.text());
        rows += parsed.length;
        const r = toScores(parsed, p.benchmark, models, { source: p.url, today, aggregate: p.aggregate, vendorReported: p.vendorReported });
        scores.push(...r.scores);
        unmatched.push(...r.unmatched.filter((n) => !unmatched.includes(n)).slice(0, 5));
      } catch (e: any) {
        errors.push(`${p.benchmark}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    return { id: 'codesota', ok: scores.length > 0, scores, rows, unmatched, ...(errors.length ? { error: errors.join('; ') } : {}) };
  },
};

// ── Scale SEAL: SWE-bench Pro (public) ─────────────────────────────────────

export const SEAL_URL = 'https://scale.com/leaderboard/swe_bench_pro_public';

/** The SEAL page renders each row as a `data-model-name` <p> followed by the score <span>. */
export function parseSeal(html: string): Array<{ name: string; value: number }> {
  const out: Array<{ name: string; value: number }> = [];
  const re = /data-model-name="true"[^>]*>([^<]+)<\/p>\s*<p[^>]*>\s*<span[^>]*>([\d.]+)<\/span>/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decodeEntities(m[1]).trim();
    if (seen.has(name)) continue; // the page repeats the table (desktop + mobile)
    seen.add(name);
    out.push({ name, value: Number(m[2]) });
  }
  return out;
}

export const sealSource: Source = {
  id: 'seal',
  benchmarks: ['swe-bench-pro'],
  async fetch(fetcher, models, today) {
    try {
      const res = await fetcher(SEAL_URL);
      if (!res.ok) return { id: 'seal', ok: false, scores: [], rows: 0, unmatched: [], error: `HTTP ${res.status}` };
      const parsed = parseSeal(await res.text());
      const r = toScores(parsed, 'swe-bench-pro', models, { source: SEAL_URL, today, aggregate: 'max' });
      return { id: 'seal', ok: r.scores.length > 0, scores: r.scores, rows: parsed.length, unmatched: r.unmatched };
    } catch (e: any) {
      return { id: 'seal', ok: false, scores: [], rows: 0, unmatched: [], error: String(e?.message || e).slice(0, 200) };
    }
  },
};

export const DEFAULT_SOURCES: readonly Source[] = [arenaSource, sealSource, codesotaSource];

// Leaderboard sources. Every adapter is deterministic — fixed URLs, fixed
// parsing rules, no model in the loop. Sources return RAW rows (board name +
// value); refresh() builds the catalog from those names, so a model that
// appears on a board tomorrow needs no code change.
//
// `fetch` is injected so tests run on fixtures and Workers can pass their own.

import { normalizeModelName } from '../matrix.ts';
import type { Score } from '../types.ts';

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface RawRow {
  benchmark: string;
  name: string;
  value: number;
  /** Half-width of the source's confidence interval (raw units), when published. */
  ci?: number;
  date?: string;
  source: string;
  /** How several rows for one model combine: best variant, or median across agents. */
  aggregate: 'max' | 'median';
  vendorReported?: boolean;
}

export interface SourceResult {
  id: string;
  ok: boolean;
  raw: RawRow[];
  error?: string;
}

export interface Source {
  id: string;
  benchmarks: string[];
  fetch(fetcher: Fetcher, today: string): Promise<SourceResult>;
}

/**
 * Raw rows → one Score per (catalog key, benchmark). `max` keeps the best
 * variant (and its CI); `median` takes the median across agents (no CI).
 * Rows whose key is not in `keys` are dropped (pruned from the catalog).
 */
export function aggregateScores(raw: readonly RawRow[], keys: ReadonlySet<string>, today: string): Score[] {
  const groups = new Map<string, RawRow[]>();
  for (const r of raw) {
    if (!Number.isFinite(r.value)) continue;
    const key = normalizeModelName(r.name);
    if (!keys.has(key)) continue;
    const k = `${key}|${r.benchmark}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Score[] = [];
  for (const [k, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [model, benchmark] = k.split('|');
    const sorted = [...rows].sort((a, b) => a.value - b.value);
    const date = rows.map((r) => r.date || today).sort().pop()!;
    let value: number, ci: number | undefined;
    if (rows[0].aggregate === 'max') { const top = sorted[sorted.length - 1]; value = top.value; ci = top.ci; }
    else { const n = sorted.length; value = n % 2 ? sorted[(n - 1) / 2].value : (sorted[n / 2 - 1].value + sorted[n / 2].value) / 2; }
    out.push({
      model, benchmark, value: Math.round(value * 100) / 100, source: rows[0].source, asOf: date,
      ...(ci !== undefined && Number.isFinite(ci) ? { ci: Math.round(ci * 100) / 100 } : {}),
      ...(rows[0].vendorReported ? { vendorReported: true } : {}),
    });
  }
  return out;
}

// ── LMArena (arena.ai) via its official Hugging Face dataset ───────────────

const ARENA_DATASET = 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main';

/** benchmark id → [dataset config, category]. Arena's own category names — no model names. */
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

/** Text/webdev/image arenas publish `rating` (+ bounds); the Agent Arena publishes `score` (+ ci bounds). */
export interface ArenaRow {
  model_name: string;
  category: string;
  rating?: number; rating_lower?: number; rating_upper?: number;
  score?: number; score_ci_lower?: number; score_ci_upper?: number;
  leaderboard_publish_date?: string;
}

const num = (v: unknown) => (v == null ? undefined : Number(v));

async function readParquet(buf: ArrayBuffer): Promise<ArenaRow[]> {
  const { parquetReadObjects } = await import('hyparquet');
  const rows = (await parquetReadObjects({ file: buf })) as any[];
  return rows.map((r) => ({
    model_name: String(r.model_name), category: String(r.category),
    rating: num(r.rating), rating_lower: num(r.rating_lower), rating_upper: num(r.rating_upper),
    score: num(r.score), score_ci_lower: num(r.score_ci_lower), score_ci_upper: num(r.score_ci_upper),
    leaderboard_publish_date: r.leaderboard_publish_date ? String(r.leaderboard_publish_date) : undefined,
  }));
}

export function arenaRaw(rowsByConfig: Map<string, ArenaRow[]>): RawRow[] {
  const out: RawRow[] = [];
  for (const [bench, [config, category]] of Object.entries(ARENA_MAP)) {
    for (const x of rowsByConfig.get(config) || []) {
      if (x.category !== category) continue;
      const value = x.rating ?? x.score;
      if (value == null) continue;
      const lo = x.rating != null ? x.rating_lower : x.score_ci_lower;
      const hi = x.rating != null ? x.rating_upper : x.score_ci_upper;
      out.push({
        benchmark: bench, name: x.model_name, value,
        ...(lo != null && hi != null ? { ci: (hi - lo) / 2 } : {}),
        date: x.leaderboard_publish_date, source: `lmarena-ai/leaderboard-dataset (${config}/${category})`, aggregate: 'max',
      });
    }
  }
  return out;
}

export const arenaSource: Source = {
  id: 'arena',
  benchmarks: Object.keys(ARENA_MAP),
  async fetch(fetcher) {
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
    const raw = arenaRaw(byConfig);
    return { id: 'arena', ok: raw.length > 0, raw, ...(errors.length ? { error: errors.join('; ') } : {}) };
  },
};

// ── Codesota (leaderboard pages, server-rendered HTML) ─────────────────────

export function htmlCells(html: string): string[] {
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  return t.split(/<[^>]+>/).map((c) => decodeEntities(c).trim()).filter(Boolean);
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** Rows read as: rank · model · [API|Open…] · org · "Mon YYYY" · source · score — anchored on the date cell. */
export function parseCodesota(html: string): Array<{ name: string; value: number; date: string; source: string }> {
  const cells = htmlCells(html);
  const out: Array<{ name: string; value: number; date: string; source: string }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < cells.length; i++) {
    if (!/^\d{2}$/.test(cells[i])) continue;
    let d = -1;
    for (let j = i + 2; j < Math.min(cells.length, i + 7); j++) if (/^[A-Z][a-z]{2} \d{4}$/.test(cells[j])) { d = j; break; }
    if (d < 0) continue;
    const name = cells[i + 1];
    const source = cells[d + 1] || '';
    const n = cells[d + 2];
    if (!name || /^\d+$/.test(name) || !/^\d+(\.\d+)?$/.test(n || '')) continue;
    const key = `${cells[i]}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [mon, yr] = cells[d].split(' ');
    out.push({ name, value: Number(n), date: `${yr}-${MONTHS[mon] || '01'}-01`, source });
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
  async fetch(fetcher) {
    const raw: RawRow[] = [];
    const errors: string[] = [];
    for (const p of CODESOTA_PAGES) {
      try {
        const res = await fetcher(p.url);
        if (!res.ok) { errors.push(`${p.benchmark}: HTTP ${res.status}`); continue; }
        for (const r of parseCodesota(await res.text())) {
          raw.push({ benchmark: p.benchmark, name: r.name, value: r.value, date: r.date, source: p.url, aggregate: p.aggregate, vendorReported: p.vendorReported });
        }
      } catch (e: any) {
        errors.push(`${p.benchmark}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    return { id: 'codesota', ok: raw.length > 0, raw, ...(errors.length ? { error: errors.join('; ') } : {}) };
  },
};

// ── Scale SEAL: SWE-bench Pro (public) ─────────────────────────────────────

export const SEAL_URL = 'https://scale.com/leaderboard/swe_bench_pro_public';

/** Each row: a `data-model-name` <p>, then the score <span> and its ± <span>. */
export function parseSeal(html: string): Array<{ name: string; value: number; ci?: number }> {
  const out: Array<{ name: string; value: number; ci?: number }> = [];
  const re = /data-model-name="true"[^>]*>([^<]+)<\/p>\s*<p[^>]*>\s*<span[^>]*>([\d.]+)<\/span>(?:\s*<span[^>]*>±(?:<!-- -->)?([\d.]+)<\/span>)?/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decodeEntities(m[1]).trim();
    if (seen.has(name)) continue; // the page repeats the table (desktop + mobile)
    seen.add(name);
    out.push({ name, value: Number(m[2]), ...(m[3] ? { ci: Number(m[3]) } : {}) });
  }
  return out;
}

export const sealSource: Source = {
  id: 'seal',
  benchmarks: ['swe-bench-pro'],
  async fetch(fetcher, today) {
    try {
      const res = await fetcher(SEAL_URL);
      if (!res.ok) return { id: 'seal', ok: false, raw: [], error: `HTTP ${res.status}` };
      const raw: RawRow[] = parseSeal(await res.text()).map((r) => ({ benchmark: 'swe-bench-pro', name: r.name, value: r.value, ...(r.ci ? { ci: r.ci } : {}), date: today, source: SEAL_URL, aggregate: 'max' }));
      return { id: 'seal', ok: raw.length > 0, raw };
    } catch (e: any) {
      return { id: 'seal', ok: false, raw: [], error: String(e?.message || e).slice(0, 200) };
    }
  },
};

export const DEFAULT_SOURCES: readonly Source[] = [arenaSource, sealSource, codesotaSource];

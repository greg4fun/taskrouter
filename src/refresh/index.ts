// refresh(): pull every source, build the model catalog from what the boards
// list and what the CLIs report (catalog.buildCatalog — no model names in
// code), aggregate scores, merge over the previous snapshot (a source that is
// down keeps yesterday's numbers), stamp a new matrix version.

import { buildCatalog, type CliModel } from '../catalog.ts';
import { buildMatrix, mergeScores, normalizeModelName } from '../matrix.ts';
import type { Matrix, Score } from '../types.ts';
import { DEFAULT_SOURCES, aggregateScores, type Fetcher, type RawRow, type Source, type SourceResult } from './sources.ts';

export * from './sources.ts';

export interface RefreshOptions {
  previous?: Matrix | null;
  /** What each CLI can run (refresh/discover.ts discoverCliModels(), or your own list). */
  cliModels?: CliModel[];
  sources?: readonly Source[];
  fetcher?: Fetcher;
  /** ISO timestamp; defaults to now. */
  now?: string;
  /** Extra scores to merge (e.g. private-eval rows from your own run log). */
  extraScores?: Score[];
  /** Keep this many top models per benchmark even when no CLI can run them (stats board context). */
  topN?: number;
}

const UA = 'taskrouter-refresh/0.2 (+https://github.com/greg4fun/taskrouter)';

export const defaultFetcher: Fetcher = (url) => fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });

/** Keys in the top `n` of any benchmark. */
function topKeys(raw: readonly RawRow[], n: number): Set<string> {
  const by = new Map<string, Map<string, number>>();
  for (const r of raw) {
    const k = normalizeModelName(r.name);
    if (!by.has(r.benchmark)) by.set(r.benchmark, new Map());
    const m = by.get(r.benchmark)!;
    m.set(k, Math.max(m.get(k) ?? -Infinity, r.value));
  }
  const keep = new Set<string>();
  for (const m of by.values()) for (const [k] of [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)) keep.add(k);
  return keep;
}

export async function refresh(opts: RefreshOptions = {}): Promise<{ matrix: Matrix; results: SourceResult[] }> {
  const now = opts.now || new Date().toISOString();
  const today = now.slice(0, 10);
  const fetcher = opts.fetcher || defaultFetcher;
  const results: SourceResult[] = [];
  for (const src of opts.sources || DEFAULT_SOURCES) {
    try { results.push(await src.fetch(fetcher, today)); }
    catch (e: any) { results.push({ id: src.id, ok: false, raw: [], error: String(e?.message || e).slice(0, 200) }); }
  }
  const raw = results.flatMap((r) => r.raw);
  const prevNames = (opts.previous?.models || []).map((m) => m.id);
  const top = topKeys(raw, opts.topN ?? 12);
  const models = buildCatalog({ boardNames: [...raw.map((r) => r.name), ...prevNames], cliModels: opts.cliModels || [], keep: (k) => top.has(k) });
  const keys = new Set(models.map((m) => m.id));
  const fresh = aggregateScores(raw, keys, today);
  // Private rows are replaced wholesale by the caller's tally; old public rows
  // survive only for models still in the catalog.
  const keepOld = (opts.previous?.scores || []).filter((s) => !s.benchmark.startsWith('private:') && keys.has(s.model));
  const scores = mergeScores(keepOld, [...fresh, ...(opts.extraScores || [])]);
  const matrix = buildMatrix({
    models,
    scores,
    weights: opts.previous?.weights,
    generatedAt: now,
    sources: results.map((r) => ({ id: r.id, ok: r.ok, rows: r.raw.length, fetchedAt: now, ...(r.error ? { error: r.error } : {}) })),
  });
  return { matrix, results };
}

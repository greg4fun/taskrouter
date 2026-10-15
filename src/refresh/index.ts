// refresh(): pull every source, merge over the previous snapshot (a source
// that is down keeps yesterday's numbers instead of vanishing), stamp a new
// matrix version. Run it daily (cron, GitHub Action, Worker scheduled event).

import { buildMatrix, mergeScores } from '../matrix.ts';
import { DEFAULT_MODELS } from '../models.ts';
import type { Matrix, ModelRow, Score } from '../types.ts';
import { DEFAULT_SOURCES, type Fetcher, type Source, type SourceResult } from './sources.ts';

export * from './sources.ts';

export interface RefreshOptions {
  previous?: Matrix | null;
  models?: ModelRow[];
  sources?: readonly Source[];
  fetcher?: Fetcher;
  /** ISO timestamp; defaults to now. */
  now?: string;
  /** Extra scores to merge (e.g. private-eval rows from your own run log). */
  extraScores?: Score[];
}

const UA = 'taskrouter-refresh/0.1 (+https://github.com/greg4fun/taskrouter)';

export const defaultFetcher: Fetcher = (url) => fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });

export async function refresh(opts: RefreshOptions = {}): Promise<{ matrix: Matrix; results: SourceResult[] }> {
  const now = opts.now || new Date().toISOString();
  const today = now.slice(0, 10);
  // The catalog comes from code (or the caller), never from the previous snapshot:
  // a model added to models.ts must show up on the next refresh.
  const models = opts.models || DEFAULT_MODELS;
  const fetcher = opts.fetcher || defaultFetcher;
  const results: SourceResult[] = [];
  for (const src of opts.sources || DEFAULT_SOURCES) {
    try {
      results.push(await src.fetch(fetcher, models, today));
    } catch (e: any) {
      results.push({ id: src.id, ok: false, scores: [], rows: 0, unmatched: [], error: String(e?.message || e).slice(0, 200) });
    }
  }
  const fresh = results.flatMap((r) => r.scores);
  // Private rows are replaced wholesale by the caller's current tally, never merged with old ones.
  const keepOld = (opts.previous?.scores || []).filter((s) => !s.benchmark.startsWith('private:'));
  const scores = mergeScores(keepOld, [...fresh, ...(opts.extraScores || [])]);
  const matrix = buildMatrix({
    models,
    scores,
    weights: opts.previous?.weights,
    generatedAt: now,
    sources: results.map((r) => ({ id: r.id, ok: r.ok, rows: r.rows, fetchedAt: now, ...(r.error ? { error: r.error } : {}), ...(r.unmatched.length ? { unmatched: r.unmatched } : {}) })),
  });
  return { matrix, results };
}

// The private eval: your own run outcomes become a benchmark column.
//
// Public boards cannot tell you how a model does on YOUR repos, prompts and
// fleet. Every routed run that finishes is an observation (model, category,
// success). This turns them into `private:<category>` scores the matrix weighs
// like any other benchmark — so the router learns from outcomes while staying
// deterministic: same outcome log ⇒ same scores ⇒ same decisions.

import type { CategoryId, Score } from './types.ts';

export interface Outcome {
  model: string;
  category: CategoryId;
  ok: boolean;
}

/** Fewer runs than this and a model's private score is not used at all. */
export const PRIVATE_MIN_RUNS = 3;

/**
 * Success rate per (model, category) with a Beta(1,1) prior — (ok+1)/(n+2) —
 * so 3/3 reads 80, not 100, and one lucky run cannot dominate a category.
 */
export function privateScores(outcomes: readonly Outcome[], asOf: string, minRuns = PRIVATE_MIN_RUNS): Score[] {
  const tally = new Map<string, { ok: number; n: number; model: string; category: CategoryId }>();
  for (const o of outcomes) {
    const k = `${o.model}|${o.category}`;
    const t = tally.get(k) || { ok: 0, n: 0, model: o.model, category: o.category };
    t.n += 1; if (o.ok) t.ok += 1;
    tally.set(k, t);
  }
  return [...tally.values()]
    .filter((t) => t.n >= minRuns)
    .sort((a, b) => (a.model + a.category).localeCompare(b.model + b.category))
    .map((t) => ({
      model: t.model,
      benchmark: `private:${t.category}`,
      value: Math.round(((t.ok + 1) / (t.n + 2)) * 10000) / 100,
      source: `private:${t.ok}/${t.n} runs`,
      asOf,
    }));
}

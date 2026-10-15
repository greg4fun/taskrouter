// Deterministic model selection for one category.
//
//   score(model, cat) = Σ w_b · v_b / Σ w_b          over benchmarks b with data for the model
//   coverage          = Σ w_b(model has data) / Σ w_b(any model has data)
//   adjusted          = score · (0.5 + 0.5 · coverage)
//
// v_b is the normalised value (matrix.normalizeValue). A model with no number
// on a benchmark uses its predecessor's (`inheritsFrom` chain), flagged. A
// model with zero coverage is never picked. Then, by policy:
//
//   quality  — highest adjusted score.
//   balanced — among candidates within `margin` points of the top, the cheapest
//              (cost tier, then relativeCost); ties → higher score → id.
//   cost     — among candidates at or above `floor`, the cheapest; none → top.
//
// Fallbacks: the best candidate on a different provider first (an outage or
// quota wall on the chosen provider must not take the fallback down too), then
// the next best by score.

import { benchmarkKey, benchmarkTops, normalizeValue } from './matrix.ts';
import { categoryById } from './categories.ts';
import type { Candidate, CategoryId, Choice, Matrix, ModelRow, Policy, Route, Score } from './types.ts';

const TIER_RANK = { local: 0, subscription: 1, metered: 2 } as const;

export const DEFAULT_POLICY: Policy = {
  objective: 'balanced',
  margin: 3,
  floor: 60,
  split: true,
  splitShare: 0.5,
  minSignal: 2,
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Latest score per (model, benchmark). */
function scoreIndex(scores: readonly Score[]): Map<string, Score> {
  const idx = new Map<string, Score>();
  for (const s of scores) {
    const k = `${s.model}|${s.benchmark}`;
    const cur = idx.get(k);
    if (!cur || s.asOf > cur.asOf || (s.asOf === cur.asOf && s.value > cur.value)) idx.set(k, s);
  }
  return idx;
}

function lookup(model: ModelRow, bench: string, idx: Map<string, Score>, byId: Map<string, ModelRow>): { score: Score; inherited: boolean } | null {
  let cur: ModelRow | undefined = model;
  for (let hops = 0; cur && hops < 8; hops++) {
    const s = idx.get(`${cur.id}|${bench}`);
    if (s) return { score: s, inherited: hops > 0 };
    cur = cur.inheritsFrom ? byId.get(cur.inheritsFrom) : undefined;
  }
  return null;
}

function pickRoute(model: ModelRow, policy: Policy, modality: 'image' | 'mesh' | undefined): { route: Route | null; reason?: string } {
  if (!model.routes.length) return { route: null, reason: 'no CLI route' };
  const avail = policy.available && policy.available.length ? new Set(policy.available) : null;
  const usable = model.routes.filter((r) => !avail || avail.has(r.provider));
  if (!usable.length) return { route: null, reason: `provider not available (${model.routes.map((r) => r.provider).join(', ')})` };
  if (modality === 'image') {
    const r = usable.find((x) => x.modalities?.includes('image'));
    if (!r) return { route: null, reason: 'no image-capable route' };
    return { route: r };
  }
  return { route: usable[0] };
}

export interface SelectOptions {
  /** Ignore the category's modality requirement (used for the text fallback). */
  ignoreModality?: boolean;
}

/** Rank every model for a category and choose one. Pure. */
export function selectModel(category: CategoryId, matrix: Matrix, policy: Policy = DEFAULT_POLICY, opts: SelectOptions = {}): Choice {
  const weights = matrix.weights[category] || matrix.weights.general;
  const idx = scoreIndex(matrix.scores);
  const byId = new Map(matrix.models.map((m) => [m.id, m]));
  const bench = new Map(matrix.benchmarks.map((b) => [b.id, b]));
  const tops = benchmarkTops(matrix.scores);
  const modality = opts.ignoreModality ? undefined : categoryById(category)?.modality === 'image' ? 'image' as const : undefined;
  const exclude = new Set(policy.exclude || []);

  // Only benchmarks that have at least one number in this snapshot count.
  const live = Object.entries(weights)
    .map(([b, w]) => ({ b, key: benchmarkKey(b, category), w }))
    .filter(({ key, w }) => w > 0 && tops.has(key));
  const liveWeight = live.reduce((a, x) => a + x.w, 0);

  const candidates: Candidate[] = [];
  for (const model of [...matrix.models].sort((a, b) => a.id.localeCompare(b.id))) {
    const parts: Record<string, number> = {};
    const inherited: string[] = [];
    let num = 0, den = 0;
    for (const { b, key, w } of live) {
      const hit = lookup(model, key, idx, byId);
      if (!hit) continue;
      const v = normalizeValue(bench.get(b), hit.score.value, tops.get(key)!);
      parts[b] = round(v);
      if (hit.inherited) inherited.push(b);
      num += w * v; den += w;
    }
    const coverage = liveWeight > 0 ? den / liveWeight : 0;
    const raw = den > 0 ? num / den : 0;
    const score = round(raw * (0.5 + 0.5 * coverage));
    const { route, reason } = pickRoute(model, policy, modality);
    const excluded = exclude.has(model.id) || (route && exclude.has(route.provider)) ? 'excluded by policy'
      : !route ? reason
      : den === 0 ? 'no benchmark data'
      : undefined;
    candidates.push({
      model: model.id, label: model.label, route: route || model.routes[0] || { provider: '-', model: '-' },
      score, coverage: round(coverage), costTier: model.costTier, relativeCost: model.relativeCost,
      inherited, parts, ...(excluded ? { excluded } : {}),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.model.localeCompare(b.model));
  const eligible = candidates.filter((c) => !c.excluded);
  if (!eligible.length) return { category, chosen: null, fallbacks: [], candidates, rule: 'no eligible model' };

  const top = eligible[0];
  const cheaper = (a: Candidate, b: Candidate) =>
    TIER_RANK[a.costTier] - TIER_RANK[b.costTier] || a.relativeCost - b.relativeCost || b.score - a.score || a.model.localeCompare(b.model);
  let chosen = top;
  let rule = `quality: highest score (${top.score})`;
  if (policy.objective === 'balanced') {
    const pool = eligible.filter((c) => c.score >= top.score - policy.margin).sort(cheaper);
    chosen = pool[0];
    rule = `balanced: cheapest of ${pool.length} within ${policy.margin} pts of top ${top.score}`;
  } else if (policy.objective === 'cost') {
    const pool = eligible.filter((c) => c.score >= policy.floor).sort(cheaper);
    if (pool.length) { chosen = pool[0]; rule = `cost: cheapest of ${pool.length} at or above floor ${policy.floor}`; }
    else rule = `cost: nothing clears floor ${policy.floor} → highest score`;
  }

  // First fallback: the best candidate on ANOTHER provider (survives an outage
  // or quota wall on the chosen one). Then the best of the rest, by score.
  const rest = eligible.filter((c) => c !== chosen);
  const otherProvider = rest.find((c) => c.route.provider !== chosen.route.provider);
  const fallbacks = (otherProvider ? [otherProvider, ...rest.filter((c) => c !== otherProvider)] : rest).slice(0, 3);
  return { category, chosen, fallbacks, candidates, rule };
}

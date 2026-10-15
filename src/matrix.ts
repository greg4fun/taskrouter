// The benchmark matrix: which benchmarks exist, how each category weighs them,
// how raw numbers become comparable 0–100 values, and the content hash that
// pins a decision to the exact data it used.

import type { Benchmark, CategoryId, Matrix, ModelRow, Score } from './types.ts';

export const BENCHMARKS: readonly Benchmark[] = [
  // LMArena (arena.ai) — crowd pairwise votes, one harness per arena. Published daily.
  { id: 'arena-webdev', name: 'Arena WebDev', url: 'https://arena.ai/leaderboard/webdev', measures: 'Builds a working web app from a prompt (React/TS/Tailwind), human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-agent', name: 'Arena Agent', url: 'https://arena.ai/leaderboard/agent', measures: 'Agentic coding sessions with tools, human-judged outcomes (share score)', scale: 'relative', harness: 'fixed' },
  { id: 'arena-coding', name: 'Arena Text · Coding', url: 'https://arena.ai/leaderboard/text/coding', measures: 'Coding answers in chat, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-expert', name: 'Arena Text · Expert', url: 'https://arena.ai/leaderboard/text/expert', measures: 'Expert-level prompts (professional domains), human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-hard', name: 'Arena Text · Hard prompts', url: 'https://arena.ai/leaderboard/text/hard_prompts', measures: 'Hard, specific, multi-step prompts', scale: 'elo', harness: 'fixed' },
  { id: 'arena-math', name: 'Arena Text · Math', url: 'https://arena.ai/leaderboard/text/math', measures: 'Math prompts, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-creative', name: 'Arena Text · Creative writing', url: 'https://arena.ai/leaderboard/text/creative_writing', measures: 'Creative writing, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-legal', name: 'Arena Text · Legal & government', url: 'https://arena.ai/leaderboard/text/industry_legal_and_government', measures: 'Prompts from legal and government work, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-medicine', name: 'Arena Text · Medicine & healthcare', url: 'https://arena.ai/leaderboard/text/industry_medicine_and_healthcare', measures: 'Prompts from medicine and healthcare, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-science', name: 'Arena Text · Life & physical science', url: 'https://arena.ai/leaderboard/text/industry_life_and_physical_and_social_science', measures: 'Life, physical and social science prompts, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-business', name: 'Arena Text · Business & finance', url: 'https://arena.ai/leaderboard/text/industry_business_and_management_and_financial_operations', measures: 'Business, management and finance prompts, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-writing', name: 'Arena Text · Writing & language', url: 'https://arena.ai/leaderboard/text/industry_writing_and_literature_and_language', measures: 'Writing, literature and language work, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-software', name: 'Arena Text · Software & IT', url: 'https://arena.ai/leaderboard/text/industry_software_and_it_services', measures: 'Software and IT-services prompts, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-instruct', name: 'Arena Text · Instruction following', url: 'https://arena.ai/leaderboard/text/instruction_following', measures: 'Following precise instructions', scale: 'elo', harness: 'fixed' },
  { id: 'arena-text', name: 'Arena Text · Overall', url: 'https://arena.ai/leaderboard/text', measures: 'General chat quality, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-search', name: 'Arena Search', url: 'https://arena.ai/leaderboard/search', measures: 'Web-grounded answers with search, human-voted', scale: 'elo', harness: 'fixed' },
  { id: 'arena-document', name: 'Arena Document', url: 'https://arena.ai/leaderboard/document', measures: 'Answers over long documents / PDFs', scale: 'elo', harness: 'fixed' },
  { id: 'arena-vision', name: 'Arena Vision', url: 'https://arena.ai/leaderboard/vision', measures: 'Image understanding', scale: 'elo', harness: 'fixed' },
  { id: 'arena-t2i', name: 'Arena Text-to-Image', url: 'https://arena.ai/leaderboard/text-to-image', measures: 'Image generation aesthetics, human-voted', scale: 'elo', harness: 'fixed' },
  // Agentic coding boards.
  { id: 'swe-bench-pro', name: 'SWE-bench Pro (SEAL)', url: 'https://scale.com/leaderboard/swe_bench_pro_public', measures: 'Real repo issues, fixed scaffold (250 turns) — isolates the model', scale: 'percent', harness: 'fixed' },
  { id: 'terminal-bench-2', name: 'Terminal-Bench 2.0', url: 'https://www.codesota.com/browse/agentic/autonomous-coding/terminal-bench-2', measures: 'Terminal tasks: SWE, sysadmin, security, data — agent+model pairs (median taken)', scale: 'percent', harness: 'mixed' },
  { id: 'swe-bench-verified', name: 'SWE-bench Verified', url: 'https://www.codesota.com/browse/agentic/swe-bench/swe-bench-verified-agentic', measures: 'Python repo issues (saturated; mostly vendor-reported)', scale: 'percent', harness: 'vendor' },
  // Reasoning.
  { id: 'gpqa', name: 'GPQA Diamond', url: 'https://www.codesota.com/browse/reasoning/multi-step-reasoning/gpqa', measures: 'Graduate-level biology, chemistry, physics questions', scale: 'percent', harness: 'vendor' },
  // Your own outcomes: success rate of routed runs, per category (see private.ts).
  { id: 'private', name: 'Private eval (your runs)', url: 'private:', measures: 'Share of routed runs in this category that finished successfully on your fleet', scale: 'percent', harness: 'fixed' },
];

const W = (o: Record<string, number>) => o;

/**
 * category → benchmark weights. `private` is the per-category private eval.
 * Benchmarks with no data in a snapshot drop out and the rest are re-weighted,
 * so these can name sources that are temporarily unavailable.
 */
export const DEFAULT_WEIGHTS: Record<CategoryId, Record<string, number>> = {
  coding:   W({ 'arena-agent': 0.2, 'swe-bench-pro': 0.2, 'terminal-bench-2': 0.15, 'arena-coding': 0.15, 'arena-software': 0.1, 'swe-bench-verified': 0.05, private: 0.15 }),
  webdev:   W({ 'arena-webdev': 0.55, 'arena-agent': 0.15, 'swe-bench-pro': 0.1, 'arena-coding': 0.05, private: 0.15 }),
  'ui-ux':  W({ 'arena-webdev': 0.65, 'arena-vision': 0.1, 'arena-creative': 0.05, private: 0.2 }),
  infra:    W({ 'terminal-bench-2': 0.4, 'arena-agent': 0.2, 'arena-software': 0.1, 'swe-bench-pro': 0.15, private: 0.15 }),
  security: W({ 'terminal-bench-2': 0.3, 'arena-software': 0.15, 'arena-expert': 0.15, 'arena-agent': 0.15, gpqa: 0.1, private: 0.15 }),
  data:     W({ 'arena-math': 0.25, 'arena-coding': 0.25, gpqa: 0.15, 'arena-agent': 0.2, private: 0.15 }),
  research: W({ 'arena-search': 0.3, 'arena-expert': 0.15, 'arena-science': 0.1, 'arena-document': 0.1, gpqa: 0.1, 'arena-hard': 0.1, private: 0.15 }),
  seo:      W({ 'arena-search': 0.3, 'arena-writing': 0.15, 'arena-creative': 0.1, 'arena-business': 0.15, 'arena-webdev': 0.15, private: 0.15 }),
  writing:  W({ 'arena-writing': 0.35, 'arena-creative': 0.35, 'arena-instruct': 0.15, private: 0.15 }),
  business: W({ 'arena-business': 0.45, 'arena-expert': 0.15, 'arena-hard': 0.1, 'arena-search': 0.15, private: 0.15 }),
  legal:    W({ 'arena-legal': 0.45, 'arena-document': 0.15, 'arena-expert': 0.15, 'arena-hard': 0.1, private: 0.15 }),
  health:   W({ 'arena-medicine': 0.45, 'arena-expert': 0.15, gpqa: 0.1, 'arena-search': 0.15, private: 0.15 }),
  biomed:   W({ 'arena-science': 0.3, 'arena-medicine': 0.2, gpqa: 0.25, 'arena-expert': 0.1, private: 0.15 }),
  image:    W({ 'arena-t2i': 0.85, private: 0.15 }),
  '3d':     W({ 'arena-webdev': 0.35, 'arena-coding': 0.2, 'arena-agent': 0.2, 'arena-math': 0.05, private: 0.2 }),
  general:  W({ 'arena-text': 0.4, 'arena-hard': 0.2, 'arena-instruct': 0.1, 'arena-agent': 0.15, private: 0.15 }),
};

/** Private-eval rows carry the category in the benchmark id: `private:coding`. */
export function benchmarkKey(benchmark: string, category: CategoryId): string {
  return benchmark === 'private' ? `private:${category}` : benchmark;
}

// ── Name matching ─────────────────────────────────────────────────────────

/**
 * Leaderboards spell one model many ways: "Claude Opus 4.6",
 * "claude-opus-4-6-high", "ForgeCode / Claude Opus 4.6", "gpt-5.4 (xHigh)*",
 * "claude-opus-4-5-20251101-high-32k". Reduce each to `claude-opus-4-6`.
 */
export function normalizeModelName(raw: string): string {
  let s = String(raw || '').toLowerCase().trim();
  if (s.includes(' / ')) s = s.split(' / ').pop()!; // "Agent / Model" → model
  s = s.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\*/g, ' ');
  s = s.replace(/[\s._]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  // trailing variant / effort / date markers, repeatedly
  const TRAIL = /-(max|xhigh|high|medium|low|minimal|thinking|search|grounding|instant|preview|exp|experimental|latest|beta\d*|\d+k|20\d{6}|\d{4}|codex-harness)$/;
  for (let i = 0; i < 6 && TRAIL.test(s); i++) s = s.replace(TRAIL, '');
  // "claude-4-5-sonnet" → "claude-sonnet-4-5"
  s = s.replace(/^claude-(\d+(?:-\d+)?)-(opus|sonnet|haiku|fable)$/, 'claude-$2-$1');
  return s;
}

/** Index aliases → model id. */
export function aliasIndex(models: readonly ModelRow[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const m of models) {
    for (const a of [m.id, m.label, ...m.aliases]) {
      const k = normalizeModelName(a);
      if (k && !idx.has(k)) idx.set(k, m.id);
    }
  }
  return idx;
}

// ── Normalisation ─────────────────────────────────────────────────────────

/**
 * Raw score → 0–100.
 *   percent: as-is, clamped.
 *   relative: value / leader × 100.
 *   elo:     200 × expected win rate against the board leader
 *            (Bradley–Terry / Elo, 400-point scale), so the leader = 100,
 *            −31 points ≈ 91, −200 ≈ 48. A gap means the same thing on every arena.
 */
export function normalizeValue(b: Benchmark | undefined, value: number, top: number): number {
  if (!b || b.scale === 'percent') return Math.max(0, Math.min(100, value));
  if (b.scale === 'relative') return top > 0 ? Math.max(0, Math.min(100, (value / top) * 100)) : 0;
  const p = 1 / (1 + Math.pow(10, (top - value) / 400));
  return Math.max(0, Math.min(100, 200 * p));
}

/** Leader per benchmark key (for Elo normalisation). */
export function benchmarkTops(scores: readonly Score[]): Map<string, number> {
  const tops = new Map<string, number>();
  for (const s of scores) if (!tops.has(s.benchmark) || s.value > tops.get(s.benchmark)!) tops.set(s.benchmark, s.value);
  return tops;
}

// ── Hash ──────────────────────────────────────────────────────────────────

/** FNV-1a 64 → 16 hex chars. Sync and dependency-free, enough to pin a snapshot. */
export function fnv1a(input: string): string {
  let h1 = 0x811c9dc5 | 0, h2 = 0x050c5d1f | 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 7);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/** Stable JSON: object keys sorted, so the hash ignores key order. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function matrixVersion(m: Pick<Matrix, 'models' | 'scores' | 'weights'>): string {
  const scores = [...m.scores].sort((a, b) => (a.model + a.benchmark + a.asOf).localeCompare(b.model + b.benchmark + b.asOf));
  return fnv1a(stableJson({ models: m.models, scores, weights: m.weights }));
}

/** Assemble a matrix and stamp its version. */
export function buildMatrix(input: { models: ModelRow[]; scores: Score[]; weights?: Matrix['weights']; benchmarks?: Benchmark[]; generatedAt: string; sources?: Matrix['sources'] }): Matrix {
  const weights = input.weights || DEFAULT_WEIGHTS;
  const m = { models: input.models, scores: input.scores, weights };
  return {
    version: matrixVersion(m),
    generatedAt: input.generatedAt,
    benchmarks: input.benchmarks || [...BENCHMARKS],
    ...m,
    sources: input.sources,
  };
}

/**
 * Merge new scores over old: one row per (model, benchmark); the newer asOf
 * wins, ties keep the higher value. Lets a partial refresh (one source down)
 * keep yesterday's numbers for that source instead of losing them.
 */
export function mergeScores(older: readonly Score[], newer: readonly Score[]): Score[] {
  const by = new Map<string, Score>();
  for (const s of [...older, ...newer]) {
    const k = `${s.model}|${s.benchmark}`;
    const cur = by.get(k);
    if (!cur || s.asOf > cur.asOf || (s.asOf === cur.asOf && s.value > cur.value)) by.set(k, s);
  }
  return [...by.values()].sort((a, b) => (a.model + a.benchmark).localeCompare(b.model + b.benchmark));
}

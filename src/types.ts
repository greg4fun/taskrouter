// Shared types. Everything in src/ except src/refresh and src/cli is pure:
// no node built-ins, no network, no clock unless one is passed in — so the same
// code runs in Node, Deno, Bun, browsers and Cloudflare Workers, and the same
// input always produces the same decision.

export type CategoryId =
  | 'coding' | 'webdev' | 'ui-ux' | 'infra' | 'security' | 'data'
  | 'research' | 'seo' | 'writing' | 'business' | 'legal' | 'health'
  | 'biomed' | 'image' | '3d' | 'general';

export interface Signal {
  /** Lower-case literal phrase (matched on word boundaries) or a RegExp source prefixed with `re:`. */
  pattern: string;
  weight: number;
}

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
  signals: Signal[];
  /** Regulated advice: the router tags the decision so the executor adds a disclaimer and sources. */
  advisory?: boolean;
  /** Output is not text/code — needs an executor with this modality. */
  modality?: 'image' | 'mesh';
}

/** Per-category evidence extracted from the task text. */
export interface Features {
  /** Raw weighted signal score per category. */
  scores: Record<CategoryId, number>;
  /** Which signals fired, for the audit trail. */
  hits: Record<CategoryId, string[]>;
  /** `[category: x]` / `#x` tag the author put in the task, if any. */
  explicit: CategoryId | null;
  /** Number of words in the task. */
  words: number;
}

// ── Decision tree ─────────────────────────────────────────────────────────

export type Predicate =
  | { kind: 'explicit' }
  | { kind: 'any-above'; categories: CategoryId[]; threshold: number }
  /** `category` scores at least `threshold` AND at least as much as every category in `over`. */
  | { kind: 'leads'; category: CategoryId; over: CategoryId[]; threshold: number }
  | { kind: 'always' };

export interface TreeNode {
  id: string;
  /** The question a person reads in the visual tree. */
  question: string;
  test: Predicate;
  /** Followed when the test passes. */
  yes: TreeNode | Leaf;
  /** Followed when it fails. */
  no: TreeNode | Leaf;
}

/** A leaf picks the category: the explicit tag, one fixed category, or the strongest of a set. */
export type Leaf =
  | { leaf: 'explicit'; id: string; label: string }
  | { leaf: 'fixed'; id: string; label: string; category: CategoryId }
  | { leaf: 'strongest'; id: string; label: string; among: CategoryId[] };

export interface TraceStep {
  node: string;
  question: string;
  answer: 'yes' | 'no';
  /** Why — the numbers the predicate looked at. */
  because: string;
}

// ── Benchmark matrix ──────────────────────────────────────────────────────

export interface Benchmark {
  id: string;
  name: string;
  url: string;
  /** What it actually measures, in one line. */
  measures: string;
  /**
   * percent  — used as-is (0–100).
   * elo      — 200 × expected win rate vs the board leader (leader = 100).
   * relative — value / leader's value × 100 (shares, rates on an open scale).
   */
  scale: 'percent' | 'elo' | 'relative';
  /** fixed = one harness for every model; mixed = agent+model pairs (scaffold varies). */
  harness: 'fixed' | 'mixed' | 'vendor';
}

/** One way to run a model: a CLI/provider plus the model id that CLI accepts. */
export interface Route {
  provider: string;
  model: string;
  /** Can this route produce images / meshes, not just text + code. */
  modalities?: Array<'image' | 'mesh'>;
}

export type CostTier = 'local' | 'subscription' | 'metered';

export interface ModelRow {
  /** Canonical id, e.g. `claude-opus-4.6`. */
  id: string;
  label: string;
  vendor: string;
  family: string;
  /** Parsed version numbers (`claude-opus-5-5` → [5,5]); [] when the name has none. */
  version?: number[];
  /**
   * The model this one succeeds — COMPUTED by catalog.buildCatalog (same
   * family, next-lower version), never typed in. When this model has no score
   * on a benchmark, the predecessor's is used and flagged `inherited`: new
   * releases reach the CLIs weeks before they reach the leaderboards.
   */
  inheritsFrom?: string;
  /** Names leaderboards use for this model (case-insensitive, punctuation-insensitive). */
  aliases: string[];
  routes: Route[];
  costTier: CostTier;
  /** Relative cost per typical task, 1 = cheapest frontier option. */
  relativeCost: number;
  contextWindow?: number;
}

export interface Score {
  model: string;
  benchmark: string;
  value: number;
  /** Where the number came from (URL or `private:<source>`). */
  source: string;
  /** ISO date the number was published or fetched. */
  asOf: string;
  vendorReported?: boolean;
  /** Half-width of the source's confidence interval, in the benchmark's raw units (Arena publishes these). */
  ci?: number;
}

export interface Matrix {
  /** Content hash of models+scores — the decision records which matrix it used. */
  version: string;
  generatedAt: string;
  benchmarks: Benchmark[];
  models: ModelRow[];
  scores: Score[];
  /** category → benchmark → weight (weights per category sum to 1). */
  weights: Record<CategoryId, Record<string, number>>;
  /** What happened on the last refresh, per source. */
  sources?: Array<{ id: string; ok: boolean; rows: number; error?: string; fetchedAt: string; unmatched?: string[] }>;
}

// ── Routing ──────────────────────────────────────────────────────────────

export interface Policy {
  /**
   * quality  = highest score wins.
   * balanced = cheapest candidate within `margin` points of the top (default).
   * cost     = cheapest candidate that clears `floor`.
   */
  objective: 'quality' | 'balanced' | 'cost';
  margin: number;
  floor: number;
  /** Objective for advisory categories (legal, health, biomed); default 'quality'. */
  advisoryObjective?: 'quality' | 'balanced' | 'cost';
  /** Providers that can actually run work right now. Empty/undefined = all. */
  available?: string[];
  /** Never pick these models / providers. */
  exclude?: string[];
  /** Split multi-category tasks into subtasks. */
  split: boolean;
  /** A category needs this share of the top category's score to earn its own subtask. */
  splitShare: number;
  /** Score a category needs before it counts at all. */
  minSignal: number;
}

export interface Candidate {
  model: string;
  label: string;
  route: Route;
  /** 0–100 weighted benchmark score for the category. */
  score: number;
  /** Share of the category's benchmark weight that had data (0–1). */
  coverage: number;
  costTier: CostTier;
  relativeCost: number;
  family?: string;
  version?: number[];
  /** Weighted half-width of the confidence intervals behind `score`, in normalised points. */
  uncertainty: number;
  /** Benchmark ids whose score was inherited from an older model in the same family. */
  inherited: string[];
  /** benchmark → normalised value used. */
  parts: Record<string, number>;
  excluded?: string;
}

export interface Choice {
  category: CategoryId;
  chosen: Candidate | null;
  fallbacks: Candidate[];
  candidates: Candidate[];
  rule: string;
}

export interface Subtask {
  id: string;
  category: CategoryId;
  text: string;
  dependsOn: string[];
  choice: Choice;
}

export interface Decision {
  /** Deterministic id: hash(task + matrix.version + policy). */
  id: string;
  task: string;
  matrixVersion: string;
  policy: Policy;
  features: Features;
  trace: TraceStep[];
  leaf: string;
  category: CategoryId;
  advisory: boolean;
  modality: 'text' | 'image' | 'mesh';
  choice: Choice;
  /** Present when the task was split; the top-level choice is the first subtask's. */
  subtasks: Subtask[];
  warnings: string[];
}

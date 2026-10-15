// taskrouter — deterministic task → category → model routing across agent CLIs.
// Core entry point: pure, no node built-ins (safe for browsers and Workers).
// Node-only pieces: `taskrouter/refresh` (leaderboard fetchers) and the CLI.

export * from './types.ts';
export { CATEGORIES, CATEGORY_IDS, categoryById, extractFeatures, isCategoryId } from './categories.ts';
export { TREE, classify, walkTree, flattenTree, isLeaf } from './tree.ts';
export {
  BENCHMARKS, DEFAULT_WEIGHTS, aliasIndex, benchmarkKey, buildMatrix, fnv1a, matrixVersion, mergeScores,
  normalizeModelName, normalizeValue, stableJson,
} from './matrix.ts';
export { buildCatalog, parseModelName, prettyLabel, compareVersions, patternRoutes, cliIdToKey, COST_RULES, PROVIDER_TIER, type CliModel } from './catalog.ts';
export { DEFAULT_POLICY, selectModel } from './select.ts';
export { STAGE, segment, splitTask } from './split.ts';
export { route, summarize, type RouteOptions } from './route.ts';
export { PRIVATE_MIN_RUNS, privateScores, type Outcome } from './private.ts';

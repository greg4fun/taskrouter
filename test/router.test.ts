import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildMatrix, classify, extractFeatures, flattenTree, normalizeModelName, normalizeValue, privateScores, route,
  segment, selectModel, BENCHMARKS, DEFAULT_POLICY, mergeScores, buildCatalog, parseModelName, prettyLabel, cliIdToKey,
} from '../src/index.ts';
import { parseCodesota, parseSeal, aggregateScores, arenaRaw, type RawRow } from '../src/refresh/sources.ts';
import { parseAgyModels, parseGrokModels, parseCodexCache, parseTomlModelTables } from '../src/refresh/discover.ts';
import { invocationFor } from '../src/cli/adapters.ts';
import type { ModelRow, Score } from '../src/types.ts';

const fx = (n: string) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

// A small hand-made matrix: numbers are test data, not claims about real models.
const MODELS: ModelRow[] = [
  { id: 'a-big', label: 'A Big', vendor: 'A', family: 'a', aliases: [], routes: [{ provider: 'alpha', model: 'big' }], costTier: 'subscription', relativeCost: 5 },
  { id: 'a-small', label: 'A Small', vendor: 'A', family: 'a', aliases: [], routes: [{ provider: 'alpha', model: 'small' }], costTier: 'subscription', relativeCost: 1 },
  { id: 'b-pro', label: 'B Pro', vendor: 'B', family: 'b', version: [1], aliases: [], routes: [{ provider: 'beta', model: 'pro' }], costTier: 'metered', relativeCost: 3 },
  { id: 'b-next', label: 'B Next', vendor: 'B', family: 'b', version: [2], inheritsFrom: 'b-pro', aliases: [], routes: [{ provider: 'beta', model: 'next' }], costTier: 'metered', relativeCost: 3 },
  { id: 'img', label: 'Img', vendor: 'B', family: 'img', aliases: [], routes: [{ provider: 'beta', model: 'pro', modalities: ['image'] }], costTier: 'metered', relativeCost: 2 },
];
const S = (model: string, benchmark: string, value: number): Score => ({ model, benchmark, value, source: 'test', asOf: '2026-10-01' });
const SCORES: Score[] = [
  S('a-big', 'swe-bench-pro', 60), S('a-small', 'swe-bench-pro', 58.5), S('b-pro', 'swe-bench-pro', 50),
  S('a-big', 'arena-webdev', 1500), S('a-small', 'arena-webdev', 1400), S('b-pro', 'arena-webdev', 1520),
  S('img', 'arena-t2i', 1300),
];
const M = buildMatrix({ models: MODELS, scores: SCORES, generatedAt: '2026-10-01T00:00:00Z' });

test('features: word-boundary signals, explicit tags, occurrence cap', () => {
  const f = extractFeatures('Build a React landing page');
  assert.ok(f.scores.webdev > 0);
  assert.equal(extractFeatures('rebuild').scores['ui-ux'], 0, '"ui" must not match inside "rebuild"');
  assert.equal(extractFeatures('do this [category: seo] please').explicit, 'seo');
  assert.equal(extractFeatures('#ui tweak it').explicit, 'ui-ux');
  const spam = extractFeatures('bug '.repeat(50));
  assert.equal(spam.scores.coding, 3 * 2, 'a signal counts at most 3 times');
});

test('tree: each branch reaches the expected category', () => {
  const cases: Array<[string, string]> = [
    ['Fix the bug in the parser and add a unit test', 'coding'],
    ['Build a landing page with Tailwind and a responsive navbar', 'webdev'],
    ['Redesign the settings screen: typography, spacing, dark mode palette', 'ui-ux'],
    ['Write a Terraform module and a Helm chart for the cluster', 'infra'],
    ['Run a security scan for OWASP vulnerabilities and leaked secrets', 'security'],
    ['Research and compare the state of the art in vector search with sources', 'research'],
    ['Do keyword research and fix meta description and sitemap for SEO', 'seo'],
    ['Review this contract clause for GDPR compliance', 'legal'],
    ['Make me a meal plan and workout plan for weight loss', 'health'],
    ['Summarise recent clinical trial results on this protein biomarker', 'biomed'],
    ['Generate an image: a logo for a bakery', 'image'],
    ['Write a Blender script that builds a 3D model of a chair mesh', '3d'],
    ['Draft a pricing strategy and go-to-market plan for the startup', 'business'],
    ['Write a blog article and proofread the newsletter copy', 'writing'],
    ['hello there', 'general'],
  ];
  for (const [text, want] of cases) assert.equal(route(text, M).category, want, text);
});

test('tree: explicit tag beats every signal', () => {
  assert.equal(route('Fix the bug in the parser [category: writing]', M).category, 'writing');
});

test('tree: trace lists every node visited and ends at a leaf in the flattened tree', () => {
  const d = route('Fix the bug in the parser', M);
  const ids = new Set(flattenTree().map((n) => n.id));
  for (const t of d.trace) assert.ok(ids.has(t.node));
  assert.ok(ids.has(d.leaf));
  assert.equal(d.trace[0].node, 'explicit');
});

test('determinism: same input + matrix + policy ⇒ identical decision and id', () => {
  const t = 'Research vector DBs, then implement a TypeScript client';
  assert.deepEqual(route(t, M), route(t, M));
  assert.notEqual(route(t, M).id, route(t, M, { policy: { objective: 'quality' } }).id);
});

test('select: balanced picks the cheapest within the margin; quality picks the top', () => {
  const q = selectModel('coding', M, { ...DEFAULT_POLICY, objective: 'quality' });
  assert.equal(q.chosen?.model, 'a-big');
  const b = selectModel('coding', M, { ...DEFAULT_POLICY, objective: 'balanced', margin: 3 });
  assert.equal(b.chosen?.model, 'a-small', '58.5 is within 3 of 60 and cheaper');
  const tight = selectModel('coding', M, { ...DEFAULT_POLICY, objective: 'balanced', margin: 1 });
  assert.equal(tight.chosen?.model, 'a-big');
});

test('select: first fallback is on a different provider', () => {
  const c = selectModel('coding', M, { ...DEFAULT_POLICY, objective: 'quality' });
  assert.notEqual(c.fallbacks[0].route.provider, c.chosen?.route.provider);
});

test('select: availability filter and exclusions', () => {
  const c = selectModel('coding', M, { ...DEFAULT_POLICY, available: ['beta'] });
  assert.equal(c.chosen?.route.provider, 'beta');
  const x = selectModel('coding', M, { ...DEFAULT_POLICY, objective: 'quality', exclude: ['a-big'] });
  assert.notEqual(x.chosen?.model, 'a-big');
});

test('select: lineage inheritance fills a missing score; the newer version supersedes a not-significantly-better older one', () => {
  const c = selectModel('coding', M, { ...DEFAULT_POLICY, objective: 'quality' });
  const next = c.candidates.find((x) => x.model === 'b-next')!;
  const pro = c.candidates.find((x) => x.model === 'b-pro')!;
  assert.ok(next.inherited.includes('swe-bench-pro'));
  assert.ok(!next.excluded);
  assert.match(pro.excluded || '', /superseded by B Next/);
});

test('select: an older version that is significantly better keeps its place', () => {
  const scores = [...SCORES, S('b-next', 'swe-bench-pro', 20)];
  const m = buildMatrix({ models: MODELS, scores, generatedAt: 'x' });
  const pro = selectModel('coding', m, { ...DEFAULT_POLICY, objective: 'quality' }).candidates.find((x) => x.model === 'b-pro')!;
  assert.ok(!pro.excluded, 'a 30-point lead is not noise');
});

test('select: advisory categories default to quality, not cost', () => {
  const scores = [S('a-big', 'arena-legal', 1500), S('a-small', 'arena-legal', 1490)];
  const m = buildMatrix({ models: MODELS, scores, generatedAt: 'x' });
  assert.equal(selectModel('legal', m).chosen?.model, 'a-big');
  assert.equal(selectModel('legal', m, { ...DEFAULT_POLICY, advisoryObjective: undefined }).chosen?.model, 'a-small');
});

test('select: elo normalisation — leader 100, -31 points ≈ 91', () => {
  const elo = BENCHMARKS.find((b) => b.id === 'arena-webdev');
  assert.equal(normalizeValue(elo, 1500, 1500), 100);
  assert.ok(Math.abs(normalizeValue(elo, 1469, 1500) - 91.1) < 0.2);
});

test('image tasks need an image-capable route; none ⇒ text fallback with a warning', () => {
  assert.equal(route('Generate an image of a logo', M).choice.chosen?.model, 'img');
  const d = route('Generate an image of a logo', M, { policy: { available: ['alpha'] } });
  assert.ok(d.choice.chosen);
  assert.ok(d.warnings.some((w) => w.includes('image-capable')));
});

test('split: multi-domain task becomes ordered subtasks with dependencies', () => {
  assert.deepEqual(segment('Research X, then implement Y and write Z'), ['Research X', 'implement Y', 'write Z']);
  const d = route('Research and compare vector databases with sources and citations, then implement a TypeScript client library with unit tests', M);
  assert.deepEqual(d.subtasks.map((s) => s.category), ['research', 'coding']);
  assert.deepEqual(d.subtasks[1].dependsOn, [d.subtasks[0].id]);
  assert.equal(route('Fix the bug in the parser', M).subtasks.length, 0);
  assert.equal(route('Research vector databases with sources, then implement a client with unit tests', M, { policy: { split: false } }).subtasks.length, 0);
});

test('names: leaderboard spellings collapse to one key', () => {
  for (const n of ['Claude Opus 4.6', 'claude-opus-4-6-high', 'ForgeCode / Claude Opus 4.6', 'claude-opus-4-6 (thinking)*', 'claude-4-6-opus']) {
    assert.equal(normalizeModelName(n), 'claude-opus-4-6', n);
  }
  assert.equal(normalizeModelName('claude-opus-4-5-20251101-high-32k'), 'claude-opus-4-5');
  assert.equal(normalizeModelName('gpt-5.6-sol-xhigh (codex-harness)'), 'gpt-5-6-sol');
  assert.equal(normalizeModelName('Claude Opus 5.5 (Max)'), 'claude-opus-5-5');
});

test('parsers: codesota + SEAL fixtures', () => {
  const tb = parseCodesota(fx('codesota-terminal-bench-2.html'));
  assert.equal(tb.length, 20);
  assert.equal(tb[0].value, 82);
  // One model appears under several agents: aggregate = median.
  const raw: RawRow[] = tb.map((r) => ({ benchmark: 'terminal-bench-2', name: r.name, value: r.value, date: r.date, source: 's', aggregate: 'median' }));
  const keys = new Set(raw.map((r) => normalizeModelName(r.name)));
  const scores = aggregateScores(raw, keys, '2026-10-15');
  const multi = [...keys].find((k) => raw.filter((r) => normalizeModelName(r.name) === k).length >= 3)!;
  const vals = raw.filter((r) => normalizeModelName(r.name) === multi).map((r) => r.value).sort((a, b) => a - b);
  assert.equal(scores.find((s) => s.model === multi)!.value, vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2);
  assert.ok(parseCodesota(fx('codesota-gpqa.html')).length >= 15);
  assert.ok(parseCodesota(fx('codesota-swe-bench-verified.html')).length >= 20);
});

test('arena: configured category only; best variant per model keeps its CI', () => {
  const rows = new Map([['webdev', [
    { model_name: 'acme-pro-2.0-max', rating: 1811, rating_lower: 1800, rating_upper: 1822, category: 'overall', leaderboard_publish_date: '2026-10-13' },
    { model_name: 'acme-pro-2.0-high', rating: 1790, category: 'overall', leaderboard_publish_date: '2026-10-13' },
    { model_name: 'acme-pro-2.0-max', rating: 1700, category: 'webdev-html', leaderboard_publish_date: '2026-10-13' },
  ]]]);
  const s = aggregateScores(arenaRaw(rows), new Set(['acme-pro-2-0']), '2026-10-15');
  assert.deepEqual(s.map((x) => [x.model, x.benchmark, x.value, x.ci]), [['acme-pro-2-0', 'arena-webdev', 1811, 11]]);
});

test('catalog: built from board names + CLI lists — no model list in code', () => {
  // Fixture names only: the catalog logic itself knows no versions.
  const models = buildCatalog({
    boardNames: ['claude-opus-9-1-max', 'Claude Opus 9', 'claude-opus-8', 'gemini-12-flash-high', 'gemini-11-flash', 'acme-ultra-3'],
    cliModels: [
      { provider: 'gemini', id: 'gemini-12-flash-high' }, { provider: 'gemini', id: 'gemini-12-flash-low' },
      { provider: 'kimi', id: 'kimi-code/k9' },
    ],
    keep: (k) => k === 'acme-ultra-3',
  });
  const by = new Map(models.map((m) => [m.id, m]));
  assert.deepEqual(by.get('claude-opus-9-1')!.routes, [{ provider: 'claude', model: 'claude-opus-9-1' }], 'pattern rule routes Claude to claude');
  assert.equal(by.get('claude-opus-9-1')!.inheritsFrom, 'claude-opus-9', 'lineage computed from versions');
  assert.equal(by.get('claude-opus-9')!.routes.length, 1, 'second-newest version still routable');
  assert.equal(by.get('claude-opus-8')?.routes.length ?? 0, 0, 'older versions get no pattern route');
  assert.deepEqual(by.get('gemini-12-flash')!.routes, [{ provider: 'gemini', model: 'gemini-12-flash-high' }], 'preferred effort variant');
  assert.equal(by.get('gemini-12-flash')!.inheritsFrom, 'gemini-11-flash');
  assert.ok(by.has('kimi-k9') && by.get('kimi-k9')!.routes[0].model === 'kimi-code/k9');
  assert.ok(by.has('acme-ultra-3'), 'top-of-board models kept for context');
  assert.equal(prettyLabel(parseModelName('claude-opus-9-1-max')), 'Claude Opus 9.1');
  assert.equal(cliIdToKey('kimi', 'kimi-code/k9'), 'kimi-k9');
});

test('discover: CLI model-list parsers', () => {
  assert.deepEqual(parseAgyModels('Fetching available models...\nm-1-high\tM 1 (High)\nm-1-low\tM 1 (Low)\n'), ['m-1-high', 'm-1-low']);
  assert.deepEqual(parseGrokModels('Available models:\n  * g-2 (default)\n  - g-1\n'), ['g-2', 'g-1']);
  assert.deepEqual(parseCodexCache(JSON.stringify({ models: [{ slug: 'x-1', visibility: 'list' }, { slug: 'x-0', visibility: 'hide' }] })), ['x-1']);
  assert.deepEqual(parseTomlModelTables('[models."kimi-code/k9"]\nmodel = "k9"\n'), ['kimi-code/k9']);
});

test('merge: newer asOf wins; partial refresh keeps old numbers', () => {
  const merged = mergeScores([S('a-big', 'gpqa', 70)], [{ ...S('a-big', 'gpqa', 75), asOf: '2026-10-02' }, S('b-pro', 'gpqa', 60)]);
  assert.deepEqual(merged.map((s) => [s.model, s.value]), [['a-big', 75], ['b-pro', 60]]);
});

test('private eval: Beta(1,1) smoothing and a minimum run count', () => {
  const out = privateScores([
    { model: 'a-big', category: 'coding', ok: true }, { model: 'a-big', category: 'coding', ok: true }, { model: 'a-big', category: 'coding', ok: true },
    { model: 'b-pro', category: 'coding', ok: true },
  ], '2026-10-15');
  assert.deepEqual(out.map((s) => [s.model, s.benchmark, s.value]), [['a-big', 'private:coding', 80]]);
  const m2 = buildMatrix({ models: MODELS, scores: [...SCORES, ...out], generatedAt: 'x' });
  assert.ok(selectModel('coding', m2).candidates.find((c) => c.model === 'a-big')!.parts.private === 80);
});

test('adapters: argv only, prompt never in a shell string, bad models dropped', () => {
  const c = invocationFor('claude', 'hi; rm -rf ~', { model: 'opus', auto: true });
  assert.deepEqual(c, { bin: 'claude', args: ['-p', '--output-format', 'text', '--dangerously-skip-permissions', '--model', 'opus'], stdin: 'hi; rm -rf ~' });
  assert.ok(!invocationFor('codex', 'x', { model: 'gpt; rm' }).args.includes('--model'));
  assert.deepEqual(invocationFor('gemini', 'p', {}).args, ['-p', 'p']);
});

test('bundled snapshot loads and routes', () => {
  const snap = JSON.parse(fs.readFileSync(new URL('../data/snapshot.json', import.meta.url), 'utf8'));
  const d = route('Fix the failing unit test in the TypeScript parser', snap);
  assert.equal(d.category, 'coding');
  assert.ok(d.choice.chosen, 'snapshot must yield a coding model');
});

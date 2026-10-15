// The model catalog is DISCOVERED, never typed in. No model version or id
// appears in this file — only version-free rules:
//
//   • which models exist     → every name on the leaderboards, normalised
//   • which CLI can run them → each CLI's own model list (agy models, grok
//                              models, codex's models cache, kimi/vibe config,
//                              ollama list) + one pattern rule for claude,
//                              whose CLI accepts any Anthropic model id
//   • lineage                → same family, next-lower parsed version number
//   • cost                   → family tier (fable > opus > sonnet > haiku …)
//
// A model released tomorrow shows up on the next refresh with no code change.
// Pure: discovery of CLI model lists happens in refresh/discover.ts (node).

import { normalizeModelName } from './matrix.ts';
import type { CostTier, ModelRow, Route } from './types.ts';

// ── Name parsing ──────────────────────────────────────────────────────────

export interface ParsedName {
  key: string;
  /** Prefix before the version + any suffix after it: `gemini-flash`, `gpt-sol`, `claude-opus`. */
  family: string;
  /** Prefix only: `gemini`, `gpt`, `claude-opus`. Lineage falls back to it. */
  base: string;
  version: number[];
}

/** `claude-opus-5-5` → family claude-opus, version [5,5]; `gemini-3-8-flash` → gemini-flash [3,8]; `kimi-k3` → kimi-k [3]. */
export function parseModelName(raw: string): ParsedName {
  const key = normalizeModelName(raw);
  const tokens: string[] = [];
  for (const t of key.split('-').filter(Boolean)) {
    // `k3` / `qwen3` → `k`,`3` ; parameter sizes (`120b`, `27b`) stay one token
    const m = t.match(/^([a-z]+)(\d+)$/);
    if (m && !/^\d+[bm]$/.test(t)) tokens.push(m[1], m[2]); else tokens.push(t);
  }
  const first = tokens.findIndex((t) => /^\d+$/.test(t));
  if (first < 0) return { key, family: key, base: key, version: [] };
  let end = first;
  while (end < tokens.length && /^\d+$/.test(tokens[end])) end++;
  const prefix = tokens.slice(0, first).join('-');
  const suffix = tokens.slice(end).join('-');
  return {
    key,
    family: suffix ? `${prefix}-${suffix}` : prefix,
    base: prefix,
    version: tokens.slice(first, end).map(Number),
  };
}

const UPPER = new Set(['gpt', 'glm', 'oss', 'gpt-oss']);
/** `claude-opus-5-5` → "Claude Opus 5.5", `gemini-3-8-flash` → "Gemini 3.8 Flash". */
export function prettyLabel(p: ParsedName): string {
  const word = (w: string) => (UPPER.has(w) ? w.toUpperCase() : /^\d+[bm]$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
  if (!p.version.length) return p.key.split('-').map(word).join(' ');
  const suffix = p.family.startsWith(p.base) ? p.family.slice(p.base.length).replace(/^-/, '') : '';
  const base = p.base.replace(/-k$/, ' K').split('-').map(word).join(' ').replace(' K', ' K');
  const sep = /K$/.test(base) ? '' : ' ';
  const head = /^gpt$/i.test(p.base) ? `${word(p.base)}-` : `${base}${sep}`;
  return `${head}${p.version.join('.')}${suffix ? ' ' + suffix.split('-').map(word).join(' ') : ''}`;
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// ── Version-free rules ────────────────────────────────────────────────────

export const VENDOR_RULES: Array<{ re: RegExp; vendor: string }> = [
  { re: /^claude-/, vendor: 'Anthropic' },
  { re: /^(gpt|o\d|chatgpt)/, vendor: 'OpenAI' },
  { re: /^(gemini|gemma|nano-banana|imagen|veo)/, vendor: 'Google' },
  { re: /^kimi/, vendor: 'Moonshot' },
  { re: /^grok/, vendor: 'xAI' },
  { re: /^(mistral|codestral|devstral|magistral)/, vendor: 'Mistral' },
  { re: /^(qwen|qwq)/, vendor: 'Alibaba' },
  { re: /^deepseek/, vendor: 'DeepSeek' },
  { re: /^glm/, vendor: 'Zhipu' },
  { re: /^(llama|muse)/, vendor: 'Meta' },
  { re: /^minimax/, vendor: 'MiniMax' },
];

/** Relative cost per typical task by FAMILY keyword (first match wins). Editable; only breaks near-ties. */
export const COST_RULES: Array<{ re: RegExp; cost: number }> = [
  { re: /fable|astra|argon|max\b/, cost: 8 },
  { re: /opus/, cost: 5 },
  { re: /^gpt-(sol|codex)?$|^gpt$|^grok$/, cost: 4 },
  { re: /pro\b|large/, cost: 3 },
  { re: /sonnet|medium/, cost: 2 },
  { re: /image|banana/, cost: 2 },
  { re: /kimi|qwen|deepseek|glm/, cost: 1.5 },
  { re: /haiku|flash|mini|nano|lite|small|oss|luna/, cost: 1 },
];

/** Billing tier by provider (what you pay to run it there), not by model. */
export const PROVIDER_TIER: Record<string, CostTier> = {
  ollama: 'local',
  claude: 'subscription', codex: 'subscription', gemini: 'subscription', kimi: 'subscription', grok: 'subscription',
  mistral: 'metered',
};

export interface CliModel {
  provider: string;
  /** Exactly what the CLI's --model flag accepts. '' = the CLI's default. */
  id: string;
  /** Can this route produce images (the CLI has an image tool backed by this model). */
  image?: boolean;
}

/**
 * CLI model id → catalog key. Most ids normalise directly; kimi's config
 * aliases (`kimi-code/<model>`) and effort-suffixed agy ids are folded here.
 */
export function cliIdToKey(provider: string, id: string): string {
  let s = id;
  if (provider === 'kimi') s = `kimi-${id.replace(/^kimi-code\//, '').replace(/^kimi-/, '')}`;
  else if (s.includes('/')) s = s.split('/').pop()!;
  return normalizeModelName(s);
}

/** Effort / variant preference when one model has several CLI ids (`-high` over `-low`). */
const VARIANT_RANK = (id: string) => (/-high$/.test(id) ? 0 : /-xhigh$|-max$/.test(id) ? 1 : /-medium$/.test(id) ? 3 : /-low$|-minimal$/.test(id) ? 5 : 2);

/** Pattern rule: claude's CLI accepts any Anthropic model id, so every Claude model on the boards is routable there. */
export function patternRoutes(key: string): CliModel[] {
  return /^claude-(opus|sonnet|haiku|fable)-\d/.test(key) ? [{ provider: 'claude', id: key }] : [];
}

/** Image models are driven THROUGH a CLI's image tool: the newest model of these families gets that CLI as a route. */
export const IMAGE_FAMILY_ROUTES: Array<{ family: RegExp; provider: string }> = [
  { family: /^gpt-image/, provider: 'codex' },
  { family: /^(nano-banana|gemini-.*image)/, provider: 'gemini' },
];

export interface BuildCatalogInput {
  /** Every model name seen on any leaderboard. */
  boardNames: string[];
  /** Discovered CLI model lists. */
  cliModels: CliModel[];
  /** Keep only models that are routable, ranked in the top `topN` of some board, or a predecessor of a routable one. */
  keep?: (key: string) => boolean;
}

export function buildCatalog(input: BuildCatalogInput): ModelRow[] {
  const byKey = new Map<string, { parsed: ParsedName; label: string; routes: Route[] }>();
  const ensure = (name: string) => {
    const parsed = parseModelName(name);
    if (!parsed.key) return null;
    if (!byKey.has(parsed.key)) byKey.set(parsed.key, { parsed, label: name, routes: [] });
    return byKey.get(parsed.key)!;
  };
  for (const n of input.boardNames) ensure(n);

  // Routes from the CLIs' own lists; per (model, provider) keep the preferred variant.
  const best = new Map<string, CliModel>();
  for (const cm of input.cliModels) {
    if (!cm.id) continue;
    const key = cliIdToKey(cm.provider, cm.id);
    const k = `${key}|${cm.provider}`;
    const cur = best.get(k);
    if (!cur || VARIANT_RANK(cm.id) < VARIANT_RANK(cur.id)) best.set(k, cm);
  }
  for (const [k, cm] of best) ensure(k.split('|')[0])!.routes.push({ provider: cm.provider, model: cm.id });
  // Pattern routes go only to the two newest versions of each family: boards
  // still list retired models, and the CLI would reject those at launch.
  const newestTwo = new Set<string>();
  const fams = new Map<string, Array<typeof byKey extends Map<any, infer V> ? V : never>>();
  for (const row of byKey.values()) { if (!fams.has(row.parsed.family)) fams.set(row.parsed.family, []); fams.get(row.parsed.family)!.push(row); }
  for (const list of fams.values()) {
    const versions = [...new Set(list.filter((r) => r.parsed.version.length).map((r) => r.parsed.version.join('.')))]
      .map((v) => v.split('.').map(Number)).sort((a, b) => compareVersions(b, a)).slice(0, 2).map((v) => v.join('.'));
    for (const r of list) if (versions.includes(r.parsed.version.join('.'))) newestTwo.add(r.parsed.key);
  }
  for (const row of byKey.values()) {
    if (!newestTwo.has(row.parsed.key)) continue;
    for (const p of patternRoutes(row.parsed.key)) {
      if (!row.routes.some((r) => r.provider === p.provider)) row.routes.push({ provider: p.provider, model: p.id });
    }
  }
  // Image routes: newest model of each image family, via the CLI that drives it.
  // Unconditional, like the claude pattern: availability is filtered at route time.
  for (const rule of IMAGE_FAMILY_ROUTES) {
    const members = [...byKey.values()].filter((r) => rule.family.test(r.parsed.key)).sort((a, b) => compareVersions(b.parsed.version, a.parsed.version) || a.parsed.key.localeCompare(b.parsed.key));
    // Every member at the newest version (branded variants of one release) is
    // routable; selection then prefers whichever scores best.
    for (const m of members.filter((x) => members[0] && compareVersions(x.parsed.version, members[0].parsed.version) === 0)) {
      m.routes.push({ provider: rule.provider, model: '', modalities: ['image'] });
    }
  }

  // Lineage: same family first, then same base, next-lower version.
  const rows = [...byKey.values()];
  const predecessor = (r: typeof rows[number]): string | undefined => {
    if (!r.parsed.version.length) return undefined;
    for (const pick of [(x: typeof r) => x.parsed.family === r.parsed.family, (x: typeof r) => x.parsed.base === r.parsed.base && x.parsed.family === x.parsed.base]) {
      const older = rows.filter((x) => x !== r && pick(x) && x.parsed.version.length && compareVersions(x.parsed.version, r.parsed.version) < 0)
        .sort((a, b) => compareVersions(b.parsed.version, a.parsed.version));
      if (older[0]) return older[0].parsed.key;
    }
    return undefined;
  };

  const out: ModelRow[] = rows.map((r) => {
    const fam = r.parsed.family;
    const cost = COST_RULES.find((c) => c.re.test(fam) || c.re.test(r.parsed.key))?.cost ?? 3;
    const tiers = r.routes.map((x) => PROVIDER_TIER[x.provider] || 'metered');
    const tier: CostTier = tiers.includes('local') ? 'local' : tiers.includes('subscription') ? 'subscription' : 'metered';
    return {
      id: r.parsed.key,
      label: prettyLabel(r.parsed),
      vendor: VENDOR_RULES.find((v) => v.re.test(r.parsed.key))?.vendor || 'other',
      family: fam,
      version: r.parsed.version,
      inheritsFrom: predecessor(r),
      aliases: [],
      routes: r.routes.sort((a, b) => a.provider.localeCompare(b.provider)),
      costTier: tier,
      relativeCost: cost,
    };
  });

  // Prune: routable rows, their predecessor chains, and whatever `keep` wants (top of boards).
  const byId = new Map(out.map((m) => [m.id, m]));
  const keep = new Set<string>();
  for (const m of out) {
    if (!m.routes.length && !(input.keep && input.keep(m.id))) continue;
    let cur: ModelRow | undefined = m;
    for (let i = 0; cur && i < 8 && !keep.has(cur.id); i++) { keep.add(cur.id); cur = cur.inheritsFrom ? byId.get(cur.inheritsFrom) : undefined; }
  }
  return out.filter((m) => keep.has(m.id)).sort((a, b) => a.id.localeCompare(b.id));
}

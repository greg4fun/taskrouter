// Default model catalog: the models reachable through the six agent CLIs this
// router drives (claude, codex, agy/gemini, kimi, grok, vibe/mistral), plus a
// few frontier models no CLI here can reach yet — kept so the stats board shows
// what you are missing.
//
// `routes[].model` is what that CLI's --model flag accepts (verified against
// each CLI's model list 2026-09/10). `relativeCost` and `costTier` are rough,
// editable estimates — they only break near-ties under the 'balanced' policy.
// Pass your own catalog to route() to change any of it.

import type { ModelRow } from './types.ts';

const m = (row: ModelRow) => row;

export const DEFAULT_MODELS: ModelRow[] = [
  // ── Anthropic ─────────────────────────────────────────────────────────
  m({ id: 'claude-fable-5.1', label: 'Claude Fable 5.1', vendor: 'Anthropic', family: 'claude-fable', inheritsFrom: 'claude-fable-5', aliases: [], routes: [{ provider: 'claude', model: 'fable' }], costTier: 'subscription', relativeCost: 8 }),
  m({ id: 'claude-fable-5', label: 'Claude Fable 5', vendor: 'Anthropic', family: 'claude-fable', inheritsFrom: 'claude-opus-5', aliases: [], routes: [], costTier: 'subscription', relativeCost: 8 }),
  m({ id: 'claude-opus-5.5', label: 'Claude Opus 5.5', vendor: 'Anthropic', family: 'claude-opus', inheritsFrom: 'claude-opus-5', aliases: ['claude-opus-5-5'], routes: [{ provider: 'claude', model: 'opus5.5' }], costTier: 'subscription', relativeCost: 5 }),
  m({ id: 'claude-opus-5', label: 'Claude Opus 5', vendor: 'Anthropic', family: 'claude-opus', inheritsFrom: 'claude-opus-4.8', aliases: [], routes: [{ provider: 'claude', model: 'opus' }], costTier: 'subscription', relativeCost: 5 }),
  m({ id: 'claude-opus-4.8', label: 'Claude Opus 4.8', vendor: 'Anthropic', family: 'claude-opus', inheritsFrom: 'claude-opus-4.7', aliases: [], routes: [{ provider: 'claude', model: 'opus4.8' }], costTier: 'subscription', relativeCost: 5 }),
  m({ id: 'claude-opus-4.7', label: 'Claude Opus 4.7', vendor: 'Anthropic', family: 'claude-opus', inheritsFrom: 'claude-opus-4.6', aliases: [], routes: [], costTier: 'subscription', relativeCost: 5 }),
  m({ id: 'claude-opus-4.6', label: 'Claude Opus 4.6', vendor: 'Anthropic', family: 'claude-opus', inheritsFrom: 'claude-opus-4.5', aliases: ['claude-4-6-opus'], routes: [{ provider: 'gemini', model: 'claude-opus-4-6-thinking' }], costTier: 'subscription', relativeCost: 5 }),
  m({ id: 'claude-opus-4.5', label: 'Claude Opus 4.5', vendor: 'Anthropic', family: 'claude-opus', aliases: ['claude-4-5-opus'], routes: [], costTier: 'subscription', relativeCost: 5 }),
  m({ id: 'claude-sonnet-5.5', label: 'Claude Sonnet 5.5', vendor: 'Anthropic', family: 'claude-sonnet', inheritsFrom: 'claude-sonnet-5', aliases: [], routes: [{ provider: 'claude', model: 'claude-sonnet-5-5' }], costTier: 'subscription', relativeCost: 2.5 }),
  m({ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', vendor: 'Anthropic', family: 'claude-sonnet', inheritsFrom: 'claude-sonnet-4.6', aliases: [], routes: [{ provider: 'claude', model: 'sonnet' }], costTier: 'subscription', relativeCost: 2 }),
  m({ id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', vendor: 'Anthropic', family: 'claude-sonnet', inheritsFrom: 'claude-sonnet-4.5', aliases: [], routes: [{ provider: 'gemini', model: 'claude-sonnet-4-6' }], costTier: 'subscription', relativeCost: 2 }),
  m({ id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', vendor: 'Anthropic', family: 'claude-sonnet', aliases: ['claude-4-5-sonnet'], routes: [], costTier: 'subscription', relativeCost: 2 }),
  m({ id: 'claude-haiku-5.5', label: 'Claude Haiku 5.5', vendor: 'Anthropic', family: 'claude-haiku', inheritsFrom: 'claude-haiku-4.5', aliases: [], routes: [{ provider: 'claude', model: 'claude-haiku-5-5' }], costTier: 'subscription', relativeCost: 1 }),
  m({ id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', vendor: 'Anthropic', family: 'claude-haiku', aliases: ['claude-4-5-haiku'], routes: [{ provider: 'claude', model: 'haiku' }], costTier: 'subscription', relativeCost: 1 }),

  // ── OpenAI ────────────────────────────────────────────────────────────
  m({ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', vendor: 'OpenAI', family: 'gpt', inheritsFrom: 'gpt-5.5', aliases: [], routes: [{ provider: 'codex', model: 'gpt-5.6-sol'}], costTier: 'subscription', relativeCost: 4 }),
  m({ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI', family: 'gpt', inheritsFrom: 'gpt-5.4', aliases: [], routes: [{ provider: 'codex', model: 'gpt-5.5'}], costTier: 'subscription', relativeCost: 4 }),
  m({ id: 'gpt-5.4', label: 'GPT-5.4', vendor: 'OpenAI', family: 'gpt', inheritsFrom: 'gpt-5.3-codex', aliases: [], routes: [], costTier: 'subscription', relativeCost: 4 }),
  m({ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', vendor: 'OpenAI', family: 'gpt', aliases: [], routes: [], costTier: 'subscription', relativeCost: 4 }),
  m({ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', vendor: 'OpenAI', family: 'gpt', aliases: [], routes: [], costTier: 'metered', relativeCost: 6 }),
  m({ id: 'gpt-6-astra', label: 'GPT-6 Astra', vendor: 'OpenAI', family: 'gpt', aliases: [], routes: [], costTier: 'metered', relativeCost: 8 }),
  m({ id: 'gpt-oss-120b', label: 'GPT-OSS 120B', vendor: 'OpenAI', family: 'gpt-oss', aliases: [], routes: [{ provider: 'gemini', model: 'gpt-oss-120b-medium' }], costTier: 'subscription', relativeCost: 0.5 }),
  m({ id: 'gpt-6-sol', label: 'GPT-6 Sol', vendor: 'OpenAI', family: 'gpt', aliases: [], routes: [], costTier: 'metered', relativeCost: 6 }),
  // Image models are reached THROUGH an agent CLI's image tool; the route names
  // the CLI + text model that drives it. Which image model a CLI's tool uses is
  // the vendor's choice — check `taskrouter matrix --category image` against
  // what your CLI actually produces.
  m({ id: 'gpt-image-2.5', label: 'GPT Image 2.5', vendor: 'OpenAI', family: 'gpt-image', inheritsFrom: 'gpt-image-2', aliases: ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'], routes: [{ provider: 'codex', model: 'gpt-5.6-sol', modalities: ['image'] }], costTier: 'subscription', relativeCost: 4 }),
  m({ id: 'gpt-image-2', label: 'GPT Image 2', vendor: 'OpenAI', family: 'gpt-image', aliases: [], routes: [], costTier: 'metered', relativeCost: 3 }),

  // ── Google ────────────────────────────────────────────────────────────
  m({ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', vendor: 'Google', family: 'gemini-flash', inheritsFrom: 'gemini-3.7-flash', aliases: [], routes: [{ provider: 'gemini', model: 'gemini-3.8-flash-high'}], costTier: 'subscription', relativeCost: 1 }),
  m({ id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', vendor: 'Google', family: 'gemini-flash', inheritsFrom: 'gemini-3-flash', aliases: [], routes: [], costTier: 'subscription', relativeCost: 1 }),
  m({ id: 'gemini-3-flash', label: 'Gemini 3 Flash', vendor: 'Google', family: 'gemini-flash', aliases: [], routes: [], costTier: 'subscription', relativeCost: 1 }),
  m({ id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', vendor: 'Google', family: 'gemini-pro', inheritsFrom: 'gemini-3-pro', aliases: [], routes: [{ provider: 'gemini', model: 'gemini-3.1-pro-high'}], costTier: 'subscription', relativeCost: 3 }),
  m({ id: 'gemini-3-pro', label: 'Gemini 3 Pro', vendor: 'Google', family: 'gemini-pro', aliases: [], routes: [], costTier: 'subscription', relativeCost: 3 }),
  m({ id: 'gemini-4-argon', label: 'Gemini 4 Argon', vendor: 'Google', family: 'gemini', aliases: [], routes: [], costTier: 'metered', relativeCost: 5 }),
  m({ id: 'nano-banana-2.1', label: 'Nano Banana 2.1', vendor: 'Google', family: 'gemini-image', inheritsFrom: 'nano-banana-2', aliases: ['gemini-nano-banana-2.1'], routes: [{ provider: 'gemini', model: 'gemini-3.8-flash-high', modalities: ['image'] }], costTier: 'subscription', relativeCost: 1.5 }),
  m({ id: 'nano-banana-2', label: 'Nano Banana 2', vendor: 'Google', family: 'gemini-image', aliases: ['gemini-nano-banana-2', 'gemini-3.1-flash-image'], routes: [], costTier: 'metered', relativeCost: 2 }),

  // ── Moonshot / xAI / Mistral ──────────────────────────────────────────
  m({ id: 'kimi-k3', label: 'Kimi K3', vendor: 'Moonshot', family: 'kimi', inheritsFrom: 'kimi-k2.6', aliases: [], routes: [{ provider: 'kimi', model: 'kimi-code/k3' }], costTier: 'subscription', relativeCost: 1.5 }),
  m({ id: 'kimi-k2.6', label: 'Kimi K2.6', vendor: 'Moonshot', family: 'kimi', inheritsFrom: 'kimi-k2.5', aliases: [], routes: [], costTier: 'subscription', relativeCost: 1.5 }),
  m({ id: 'kimi-k2.5', label: 'Kimi K2.5', vendor: 'Moonshot', family: 'kimi', aliases: [], routes: [], costTier: 'subscription', relativeCost: 1.5 }),
  m({ id: 'grok-4.6', label: 'Grok 4.6', vendor: 'xAI', family: 'grok', inheritsFrom: 'grok-4.5', aliases: [], routes: [{ provider: 'grok', model: 'grok-4.6' }], costTier: 'subscription', relativeCost: 3 }),
  m({ id: 'grok-4.5', label: 'Grok 4.5', vendor: 'xAI', family: 'grok', aliases: [], routes: [{ provider: 'grok', model: 'grok-4.5' }], costTier: 'subscription', relativeCost: 3 }),
  m({ id: 'mistral-medium-3.5', label: 'Mistral Medium 3.5', vendor: 'Mistral', family: 'mistral', aliases: [], routes: [{ provider: 'mistral', model: 'mistral-medium-3.5' }], costTier: 'metered', relativeCost: 1.5 }),
];

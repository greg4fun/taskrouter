// Discover which models each installed agent CLI can run RIGHT NOW, from the
// CLI itself. Nothing here names a model — it reads what the CLIs report:
//
//   agy      `agy models`                     (id <TAB> label)
//   grok     `grok models`                    ("* id (default)" / "- id")
//   codex    ~/.codex/models_cache.json       (slug, visibility 'list') + config.toml `model`
//   kimi     ~/.kimi-code/config.toml         ([models."<alias>"] tables)
//   vibe     ~/.vibe/config.toml              (alias / name keys)
//   ollama   `ollama list`                    (first column)
//   claude   no list command — catalog.patternRoutes covers it; reported as available
//
// Node-only. Each probe is time-boxed and failure-tolerant: a CLI that is not
// installed or not logged in contributes nothing and is reported as such.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CliModel } from '../catalog.ts';

export interface DiscoveryReport { provider: string; ok: boolean; models: number; note?: string }

function run(bin: string, args: string[]): string | null {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || '');
}

const home = (...p: string[]) => path.join(os.homedir(), ...p);
const read = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const onPath = (bin: string) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;

export function parseAgyModels(out: string): string[] {
  return out.split('\n').map((l) => l.split('\t')[0].trim()).filter((id) => /^[a-z0-9][a-z0-9._:/-]+$/i.test(id) && !/^fetching/i.test(id));
}
export function parseGrokModels(out: string): string[] {
  return [...out.matchAll(/^\s*[*-]\s+([A-Za-z0-9][A-Za-z0-9._:/-]*)/gm)].map((m) => m[1]);
}
export function parseCodexCache(json: string): string[] {
  try {
    const d = JSON.parse(json);
    return (d.models || []).filter((m: any) => m && m.slug && (m.visibility === undefined || m.visibility === 'list')).map((m: any) => String(m.slug));
  } catch { return []; }
}
export function parseTomlModelTables(toml: string): string[] {
  return [...toml.matchAll(/^\[models\."([^"]+)"\]/gm)].map((m) => m[1]);
}

export function discoverCliModels(): { models: CliModel[]; report: DiscoveryReport[] } {
  const models: CliModel[] = [];
  const report: DiscoveryReport[] = [];
  const add = (provider: string, ids: string[], note?: string) => {
    const uniq = [...new Set(ids)];
    for (const id of uniq) models.push({ provider, id });
    report.push({ provider, ok: uniq.length > 0, models: uniq.length, ...(note ? { note } : {}) });
  };

  const agy = onPath('agy') ? run('agy', ['models']) : null;
  add('gemini', agy ? parseAgyModels(agy) : [], agy ? undefined : 'agy not installed or `agy models` failed');

  const grok = onPath('grok') ? run('grok', ['models']) : null;
  add('grok', grok ? parseGrokModels(grok) : [], grok ? undefined : 'grok not installed or `grok models` failed');

  const codexIds = [...parseCodexCache(read(home('.codex', 'models_cache.json')) || '{}')];
  const codexDefault = (read(home('.codex', 'config.toml')) || '').match(/^model\s*=\s*"([^"]+)"/m)?.[1];
  if (codexDefault) codexIds.push(codexDefault);
  add('codex', onPath('codex') ? codexIds : [], onPath('codex') ? (codexIds.length ? undefined : 'no ~/.codex/models_cache.json yet (run codex once)') : 'codex not installed');

  const kimiToml = read(home('.kimi-code', 'config.toml'));
  add('kimi', onPath('kimi') || fs.existsSync(home('.kimi-code', 'bin', 'kimi')) ? parseTomlModelTables(kimiToml || '') : [], kimiToml ? undefined : 'no ~/.kimi-code/config.toml');

  const vibeToml = read(home('.vibe', 'config.toml')) || '';
  const vibeIds = [...vibeToml.matchAll(/^\s*(?:alias|name)\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  add('mistral', onPath('vibe') ? vibeIds : [], vibeIds.length ? undefined : 'no model aliases in ~/.vibe/config.toml');

  const ollama = onPath('ollama') ? run('ollama', ['list']) : null;
  add('ollama', ollama ? ollama.split('\n').slice(1).map((l) => l.split(/\s+/)[0]).filter(Boolean) : [], ollama ? undefined : 'ollama not installed or not running');

  // claude has no model list; the catalog's pattern rule routes Claude models to it.
  // Report it so callers know it is available on this machine.
  report.push({ provider: 'claude', ok: onPath('claude'), models: 0, note: 'pattern rule: any current Claude model id' });
  if (onPath('claude')) models.push({ provider: 'claude', id: '' });
  return { models, report };
}

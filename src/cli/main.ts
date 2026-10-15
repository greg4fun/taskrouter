#!/usr/bin/env node
// taskrouter CLI.
//
//   taskrouter route "<task>" [--json] [--objective quality|balanced|cost] [--available claude,codex] [--no-split]
//   taskrouter run   "<task>" [--auto] [--dry-run] [...route flags]     route, then execute on the chosen CLI(s)
//   taskrouter refresh [--out data/snapshot.json]                        pull leaderboards, write a new snapshot
//   taskrouter matrix [--category coding]                                print the ranking table
//   taskrouter tree                                                      print the decision tree
//   taskrouter detect                                                    which agent CLIs are on PATH
//
// Every `run` appends one JSON line to .taskrouter/audit.jsonl in the working
// directory: the full decision plus each executor's exit code — the audit trail.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_IDS, flattenTree, isCategoryId, route, selectModel, summarize, TREE } from '../index.ts';
import type { Decision, Matrix, Policy, TreeNode, Leaf } from '../types.ts';
import { refresh } from '../refresh/index.ts';
import { ADAPTERS, envFor, invocationFor } from './adapters.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED = path.resolve(HERE, '../../data/snapshot.json');
const LOCAL = path.join(process.env.HOME || '.', '.taskrouter', 'snapshot.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function loadMatrix(): Matrix {
  const p = arg('matrix') || (fs.existsSync(LOCAL) ? LOCAL : BUNDLED);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function onPath(bin: string): boolean {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
  return r.status === 0;
}

function detect(): string[] {
  return Object.entries(ADAPTERS).filter(([, a]) => onPath(a.bin)).map(([p]) => p);
}

function policyFromArgs(): Partial<Policy> {
  const p: Partial<Policy> = {};
  const o = arg('objective');
  if (o === 'quality' || o === 'balanced' || o === 'cost') p.objective = o;
  const avail = arg('available');
  p.available = avail ? avail.split(',').map((s) => s.trim()).filter(Boolean) : flag('all') ? undefined : detect();
  if (flag('no-split')) p.split = false;
  const margin = arg('margin');
  if (margin) p.margin = Number(margin);
  return p;
}

function printDecision(d: Decision) {
  console.log(`category  ${d.category}${d.advisory ? '  (advisory — add disclaimer + sources)' : ''}`);
  console.log(`path      ${d.trace.map((t) => `${t.node}:${t.answer}`).join(' → ')} → ${d.leaf}`);
  const c = d.choice.chosen;
  console.log(`model     ${c ? `${c.label} via ${c.route.provider} (--model ${c.route.model})  score ${c.score}  coverage ${Math.round(c.coverage * 100)}%` : 'none'}`);
  console.log(`rule      ${d.choice.rule}`);
  if (d.choice.fallbacks.length) console.log(`fallback  ${d.choice.fallbacks.map((f) => `${f.label} (${f.route.provider}, ${f.score})`).join(' · ')}`);
  for (const s of d.subtasks) {
    const sc = s.choice.chosen;
    console.log(`  └ ${s.id.split('-').pop()} ${s.category.padEnd(9)} → ${sc ? `${sc.route.provider}/${sc.route.model}` : 'none'}${s.dependsOn.length ? `  after ${s.dependsOn.map((x) => x.split('-').pop()).join(',')}` : ''}  “${s.text.slice(0, 70)}${s.text.length > 70 ? '…' : ''}”`);
  }
  for (const w of d.warnings) console.log(`warning   ${w}`);
  console.log(`decision  ${d.id}  matrix ${d.matrixVersion}`);
}

function audit(entry: unknown) {
  const dir = path.join(process.cwd(), '.taskrouter');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'audit.jsonl'), JSON.stringify(entry) + '\n');
}

function execute(provider: string, model: string, prompt: string, auto: boolean): number {
  const inv = invocationFor(provider, prompt, { model, auto });
  console.error(`\n[taskrouter] ▶ ${inv.bin} ${inv.args.filter((a) => a !== prompt).join(' ')}`);
  const r = spawnSync(inv.bin, inv.args, {
    input: inv.stdin ?? undefined,
    stdio: [inv.stdin ? 'pipe' : 'inherit', 'inherit', 'inherit'],
    env: { ...process.env, ...envFor(provider, model) },
  });
  return r.status ?? 1;
}

function subtaskPrompt(d: Decision, i: number): string {
  const s = d.subtasks[i];
  return [
    `You are doing part ${i + 1} of ${d.subtasks.length} of a larger task (${s.category}). Do ONLY your part; other agents do the rest.`,
    s.dependsOn.length ? `Earlier parts (${s.dependsOn.map((x) => x.split('-').pop()).join(', ')}) have already run in this working directory — build on their output.` : '',
    `\n## Your part\n${s.text}`,
    `\n## Whole task, for context only\n${d.task}`,
  ].filter(Boolean).join('\n');
}

function drawTree(n: TreeNode | Leaf, indent = '', edge = ''): void {
  if ((n as Leaf).leaf) { console.log(`${indent}${edge}■ ${(n as Leaf).label}`); return; }
  const t = n as TreeNode;
  console.log(`${indent}${edge}◆ ${t.question}  [${t.id}]`);
  drawTree(t.yes, indent + '   ', 'yes ');
  drawTree(t.no, indent + '   ', 'no  ');
}

async function main() {
  const cmd = process.argv[2];
  const task = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : (cmd === 'route' || cmd === 'run') && !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '';

  if (cmd === 'route') {
    const d = route(task, loadMatrix(), { policy: policyFromArgs() });
    if (flag('json')) console.log(JSON.stringify(d, null, 2)); else printDecision(d);
    return;
  }
  if (cmd === 'run') {
    const d = route(task, loadMatrix(), { policy: policyFromArgs() });
    printDecision(d);
    if (flag('dry-run')) return;
    const steps = d.subtasks.length
      ? d.subtasks.map((s, i) => ({ id: s.id, choice: s.choice, prompt: subtaskPrompt(d, i) }))
      : [{ id: d.id, choice: d.choice, prompt: d.task }];
    const results: Array<{ id: string; provider: string; model: string; exit: number }> = [];
    for (const st of steps) {
      const c = st.choice.chosen;
      if (!c) { results.push({ id: st.id, provider: '-', model: '-', exit: 2 }); break; }
      let exit = execute(c.route.provider, c.route.model, st.prompt, flag('auto'));
      let used = c;
      // One fallback on failure, on a different provider when the matrix has one.
      if (exit !== 0 && st.choice.fallbacks[0]) {
        used = st.choice.fallbacks[0];
        console.error(`[taskrouter] exit ${exit} — falling back to ${used.label} via ${used.route.provider}`);
        exit = execute(used.route.provider, used.route.model, st.prompt, flag('auto'));
      }
      results.push({ id: st.id, provider: used.route.provider, model: used.route.model, exit });
      if (exit !== 0) break;
    }
    audit({ at: new Date().toISOString(), decision: d, results });
    process.exitCode = results.every((r) => r.exit === 0) && results.length === steps.length ? 0 : 1;
    return;
  }
  if (cmd === 'refresh') {
    const prev = fs.existsSync(LOCAL) ? JSON.parse(fs.readFileSync(LOCAL, 'utf8')) : fs.existsSync(BUNDLED) ? JSON.parse(fs.readFileSync(BUNDLED, 'utf8')) : null;
    const { matrix, results } = await refresh({ previous: prev });
    const out = arg('out') || LOCAL;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(matrix, null, 1) + '\n');
    for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.id.padEnd(9)} ${String(r.scores.length).padStart(4)} scores from ${r.rows} rows${r.error ? `  (${r.error})` : ''}`);
    console.log(`matrix ${matrix.version} → ${out}`);
    if (!results.some((r) => r.ok)) process.exitCode = 1;
    return;
  }
  if (cmd === 'matrix') {
    const m = loadMatrix();
    const cats = arg('category') && isCategoryId(arg('category')) ? [arg('category')!] : CATEGORY_IDS;
    const avail = policyFromArgs().available;
    for (const cat of cats) {
      const c = selectModel(cat as any, m, { ...(await import('../select.ts')).DEFAULT_POLICY, available: avail });
      console.log(`\n${cat} — ${c.rule}`);
      for (const x of c.candidates.slice(0, 8)) console.log(`  ${x === c.chosen ? '★' : ' '} ${x.score.toFixed(1).padStart(5)}  ${x.label.padEnd(22)} ${x.route.provider.padEnd(8)} cov ${Math.round(x.coverage * 100)}%${x.inherited.length ? ' (inherited)' : ''}${x.excluded ? `  — ${x.excluded}` : ''}`);
    }
    return;
  }
  if (cmd === 'tree') { if (flag('json')) console.log(JSON.stringify(flattenTree(TREE), null, 2)); else drawTree(TREE); return; }
  if (cmd === 'detect') { console.log(detect().join(' ') || '(no agent CLIs found on PATH)'); return; }
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exitCode = cmd ? 1 : 0;
}

main().catch((e) => { console.error(e?.stack || e); process.exitCode = 1; });

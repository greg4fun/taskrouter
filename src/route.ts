// route(): task text → Decision. The one entry point most callers need.
// Pure and deterministic: same text + same matrix + same policy ⇒ same Decision
// (including its id), which is what makes the audit trail replayable.

import { categoryById } from './categories.ts';
import { fnv1a, stableJson } from './matrix.ts';
import { DEFAULT_POLICY, selectModel } from './select.ts';
import { splitTask } from './split.ts';
import { classify, TREE } from './tree.ts';
import type { Choice, CategoryId, Decision, Matrix, Policy, Subtask, TreeNode } from './types.ts';

export interface RouteOptions {
  policy?: Partial<Policy>;
  tree?: TreeNode;
}

function choose(category: CategoryId, matrix: Matrix, policy: Policy, warnings: string[]): Choice {
  const choice = selectModel(category, matrix, policy);
  if (choice.chosen || !categoryById(category)?.modality) return choice;
  // Image / 3D with no executor that can make one: fall back to the best text
  // model for the category (it can still write the SVG, the Blender script or
  // the prompt for an image model) and say so.
  // Text models have no image-arena numbers, so rank them as UI/UX work —
  // what they will actually produce is an SVG / a design / an image prompt.
  const proxy: CategoryId = category === 'image' ? 'ui-ux' : category;
  warnings.push(`no ${categoryById(category)!.modality}-capable executor available for ${category}; routed to the best ${proxy} model to produce an SVG or a prompt instead`);
  const text = selectModel(proxy, matrix, policy, { ignoreModality: true });
  return { ...text, category, rule: `${text.rule} (text fallback, ranked as ${proxy})` };
}

export function route(task: string, matrix: Matrix, opts: RouteOptions = {}): Decision {
  const policy: Policy = { ...DEFAULT_POLICY, ...(opts.policy || {}) };
  const text = String(task || '').trim();
  const { features, trace, leaf, category: treeCategory } = classify(text, opts.tree || TREE);
  const warnings: string[] = [];

  // Too little signal anywhere: general, whatever the tree's last fallback said.
  const topSignal = Math.max(...Object.values(features.scores));
  const category: CategoryId = !features.explicit && topSignal < policy.minSignal ? 'general' : treeCategory;
  if (category !== treeCategory) warnings.push(`signal ${topSignal} below minSignal ${policy.minSignal}: treated as general`);

  const cat = categoryById(category);
  const choice = choose(category, matrix, policy, warnings);
  if (!choice.chosen) warnings.push(`no eligible model for ${category} — check policy.available and the matrix`);

  const id = fnv1a(`${text}\n${matrix.version}\n${stableJson(policy)}`);
  const parts = splitTask(text, features, category, policy);
  const subtasks: Subtask[] = parts.map((p, i) => ({
    id: `${id}-${i + 1}`,
    category: p.category,
    text: p.text,
    dependsOn: p.dependsOn.map((j) => `${id}-${j + 1}`),
    choice: p.category === category ? choice : choose(p.category, matrix, policy, warnings),
  }));

  return {
    id,
    task: text,
    matrixVersion: matrix.version,
    policy,
    features,
    trace,
    leaf: leaf.id,
    category,
    advisory: !!cat?.advisory || subtasks.some((s) => categoryById(s.category)?.advisory),
    modality: cat?.modality === 'image' ? 'image' : cat?.modality === 'mesh' ? 'mesh' : 'text',
    choice,
    subtasks,
    warnings,
  };
}

/** One-line human summary, for logs and commit trailers. */
export function summarize(d: Decision): string {
  const pick = (c: Choice) => (c.chosen ? `${c.chosen.route.provider}/${c.chosen.route.model}` : 'none');
  if (d.subtasks.length) return `${d.subtasks.length} subtasks: ${d.subtasks.map((s) => `${s.category}→${pick(s.choice)}`).join(', ')}`;
  return `${d.category} → ${pick(d.choice)} (${d.choice.chosen?.score ?? '-'}; ${d.choice.rule})`;
}

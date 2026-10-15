// Deterministic split of a multi-domain task into category subtasks.
//
// 1. Cut the task into segments: bullet / numbered lines, then sentences.
// 2. Score each segment on its own; a segment with no signal joins the
//    segment before it (it is usually a continuation: "Use Tailwind.").
// 3. Group segments by category, keeping first-appearance order.
// 4. Only categories strong enough over the WHOLE task survive (share of the
//    top category's score ≥ policy.splitShare); weaker segments fold into the
//    primary category's subtask.
// 5. Order by stage — find out, decide, design, build, verify, publish — and
//    make each subtask depend on every subtask in an earlier stage.

import { extractFeatures } from './categories.ts';
import type { CategoryId, Features, Policy } from './types.ts';

export const STAGE: Record<CategoryId, number> = {
  research: 0,
  business: 1, legal: 1, health: 1, biomed: 1,
  'ui-ux': 2,
  coding: 3, webdev: 3, infra: 3, data: 3, image: 3, '3d': 3, general: 3,
  security: 4,
  seo: 5, writing: 5,
};

export interface Segment { text: string; category: CategoryId | null }

const VERBS = 'write|implement|build|create|design|redesign|deploy|research|investigate|test|add|make|draft|scan|audit|generate|fix|refactor|compare|document|translate|optimi[sz]e|publish|review|set up|configure|analy[sz]e';
const CLAUSE_CUT = new RegExp(`\\s*(?:;|,?\\s+(?:and\\s+)?then\\s+|,?\\s+after that\\s+|,?\\s+finally\\s+|,\\s+and\\s+(?=(?:${VERBS})\\b)|\\s+and\\s+(?=(?:${VERBS})\\b))\\s*`, 'i');

export function segment(text: string): string[] {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    // A bullet/numbered line is one unit; prose is cut into sentences.
    if (/^([-*•]|\d+[.)])\s+/.test(line)) { out.push(line.replace(/^([-*•]|\d+[.)])\s+/, '')); continue; }
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) {
      // Within a sentence, cut at sequencing words and at "and <verb>":
      // "research X, then implement Y and write a README" → three clauses.
      for (const clause of sentence.split(CLAUSE_CUT)) if (clause && clause.trim().length > 2) out.push(clause.trim().replace(/^[,;]\s*/, ''));
    }
  }
  return out;
}

function strongest(f: Features, allowed: Set<CategoryId>): CategoryId | null {
  let best: CategoryId | null = null, score = 0;
  for (const c of allowed) if (f.scores[c] > score) { best = c; score = f.scores[c]; }
  return best;
}

export interface SplitPart { category: CategoryId; text: string; dependsOn: number[] }

/**
 * Returns [] when the task should not be split (one category, or splitting
 * disabled). `primary` is the tree's category for the whole task.
 */
export function splitTask(text: string, whole: Features, primary: CategoryId, policy: Policy): SplitPart[] {
  if (!policy.split) return [];
  const topScore = Math.max(...Object.values(whole.scores));
  if (topScore <= 0) return [];
  const strong = new Set<CategoryId>([primary]);
  for (const [c, s] of Object.entries(whole.scores) as Array<[CategoryId, number]>) {
    if (c !== 'general' && s >= policy.minSignal && s >= policy.splitShare * topScore) strong.add(c);
  }
  if (strong.size < 2) return [];

  const segs = segment(text);
  if (segs.length < 2) return [];
  const labelled: Segment[] = [];
  for (const s of segs) {
    const cat = strongest(extractFeatures(s), strong);
    const prev = labelled[labelled.length - 1];
    labelled.push({ text: s, category: cat ?? prev?.category ?? null });
  }
  const groups = new Map<CategoryId, string[]>();
  for (const seg of labelled) {
    const cat = seg.category ?? primary;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(seg.text);
  }
  if (groups.size < 2) return [];

  const ordered = [...groups.entries()]
    .map(([category, texts], firstSeen) => ({ category, text: texts.join('\n'), firstSeen }))
    .sort((a, b) => STAGE[a.category] - STAGE[b.category] || a.firstSeen - b.firstSeen);
  return ordered.map((p, i) => ({
    category: p.category,
    text: p.text,
    dependsOn: ordered.slice(0, i).map((q, j) => (STAGE[q.category] < STAGE[p.category] ? j : -1)).filter((j) => j >= 0),
  }));
}

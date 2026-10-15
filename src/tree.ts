// The decision tree. Data, not code: the same object is evaluated here and
// drawn by any UI (LaunchPad's TaskRouter tab renders TREE and highlights the
// path a decision took). Every node asks one yes/no question over the
// per-category signal totals from categories.extractFeatures().
//
// Order matters and encodes policy:
//   1. an explicit tag from the author always wins;
//   2. non-text output (images, meshes) needs a different executor class;
//   3. regulated advice (legal / health / bio-medicine) must be recognised even
//      when the task also mentions code, so it gets disclaimers and sources;
//   4. security work is routed to security-strong models before generic coding;
//   5. building software splits into UI, infra, web and plain code;
//   6. information work splits into research, SEO, business and writing;
//   7. everything else is general.

import { CATEGORY_IDS, extractFeatures } from './categories.ts';
import type { CategoryId, Features, Leaf, Predicate, TraceStep, TreeNode } from './types.ts';

const leafStrongest = (id: string, label: string, among: CategoryId[]): Leaf => ({ leaf: 'strongest', id, label, among });
const leafFixed = (id: string, label: string, category: CategoryId): Leaf => ({ leaf: 'fixed', id, label, category });

export const TREE: TreeNode = {
  id: 'explicit',
  question: 'Did the author tag a category ([category: x] or #x)?',
  test: { kind: 'explicit' },
  yes: { leaf: 'explicit', id: 'leaf-explicit', label: 'Use the tagged category' },
  no: {
    id: 'media',
    question: 'Is the output an image or a 3D model rather than text/code?',
    test: { kind: 'any-above', categories: ['image', '3d'], threshold: 5 },
    yes: leafStrongest('leaf-media', 'Image or 3D — strongest wins', ['image', '3d']),
    no: {
      id: 'regulated',
      question: 'Is it legal, health or bio-medical advice?',
      test: { kind: 'any-above', categories: ['legal', 'health', 'biomed'], threshold: 5 },
      yes: leafStrongest('leaf-regulated', 'Regulated advisory — strongest wins', ['legal', 'health', 'biomed']),
      no: {
        id: 'security',
        question: 'Is it security scanning, hardening or threat work?',
        test: { kind: 'leads', category: 'security', over: ['infra', 'webdev', 'ui-ux'], threshold: 5 },
        yes: leafFixed('leaf-security', 'Cybersecurity', 'security'),
        no: {
          id: 'build',
          question: 'Does it build or change software?',
          test: { kind: 'any-above', categories: ['coding', 'webdev', 'ui-ux', 'infra', 'data'], threshold: 3 },
          yes: {
            id: 'ui',
            question: 'Is the visual design / UX the main deliverable?',
            test: { kind: 'leads', category: 'ui-ux', over: ['webdev', 'coding', 'infra'], threshold: 5 },
            yes: leafFixed('leaf-ui', 'UI / UX', 'ui-ux'),
            no: {
              id: 'infra',
              question: 'Is it infrastructure, deployment or CI/CD?',
              test: { kind: 'leads', category: 'infra', over: ['webdev', 'coding', 'data'], threshold: 5 },
              yes: leafFixed('leaf-infra', 'Infrastructure', 'infra'),
              no: {
                id: 'web',
                question: 'Is it a web frontend / web app?',
                test: { kind: 'leads', category: 'webdev', over: ['coding', 'data'], threshold: 4 },
                yes: leafFixed('leaf-web', 'Web dev', 'webdev'),
                no: leafStrongest('leaf-code', 'Code or data — strongest wins', ['coding', 'data']),
              },
            },
          },
          no: {
            id: 'info',
            question: 'Is it research, SEO, business advice or writing?',
            test: { kind: 'any-above', categories: ['research', 'seo', 'business', 'writing'], threshold: 2 },
            yes: leafStrongest('leaf-info', 'Information work — strongest wins', ['research', 'seo', 'business', 'writing']),
            no: leafFixed('leaf-general', 'General', 'general'),
          },
        },
      },
    },
  },
};

function maxOf(f: Features, cats: CategoryId[]): { cat: CategoryId; score: number } {
  // Ties break by the order given — deterministic, and the order lists the
  // more specialised category first.
  let best = { cat: cats[0], score: f.scores[cats[0]] };
  for (const c of cats.slice(1)) if (f.scores[c] > best.score) best = { cat: c, score: f.scores[c] };
  return best;
}

function evalPredicate(p: Predicate, f: Features): { pass: boolean; because: string } {
  switch (p.kind) {
    case 'always':
      return { pass: true, because: 'always' };
    case 'explicit':
      return f.explicit ? { pass: true, because: `tagged ${f.explicit}` } : { pass: false, because: 'no tag' };
    case 'any-above': {
      const best = maxOf(f, p.categories);
      const nums = p.categories.map((c) => `${c}=${f.scores[c]}`).join(', ');
      return { pass: best.score >= p.threshold, because: `${nums} (needs ≥${p.threshold})` };
    }
    case 'leads': {
      const own = f.scores[p.category];
      const rival = maxOf(f, p.over);
      const pass = own >= p.threshold && own >= rival.score;
      return { pass, because: `${p.category}=${own} vs ${rival.cat}=${rival.score} (needs ≥${p.threshold} and the lead)` };
    }
  }
}

export interface TreeResult {
  trace: TraceStep[];
  leaf: Leaf;
  category: CategoryId;
}

export function isLeaf(n: TreeNode | Leaf): n is Leaf {
  return (n as Leaf).leaf !== undefined;
}

/** Walk the tree for a feature set. Pure. */
export function walkTree(f: Features, tree: TreeNode = TREE): TreeResult {
  const trace: TraceStep[] = [];
  let node: TreeNode | Leaf = tree;
  while (!isLeaf(node)) {
    const r = evalPredicate(node.test, f);
    trace.push({ node: node.id, question: node.question, answer: r.pass ? 'yes' : 'no', because: r.because });
    node = r.pass ? node.yes : node.no;
  }
  let category: CategoryId;
  if (node.leaf === 'explicit') category = f.explicit || 'general';
  else if (node.leaf === 'fixed') category = node.category;
  else category = maxOf(f, node.among).cat;
  return { trace, leaf: node, category };
}

/** Classify raw text. */
export function classify(text: string, tree: TreeNode = TREE): TreeResult & { features: Features } {
  const features = extractFeatures(text);
  return { ...walkTree(features, tree), features };
}

/** Flatten the tree for UIs: nodes with parent + edge label, leaves included. */
export function flattenTree(tree: TreeNode = TREE): Array<{ id: string; parent: string | null; edge: 'yes' | 'no' | null; label: string; leaf: boolean }> {
  const out: Array<{ id: string; parent: string | null; edge: 'yes' | 'no' | null; label: string; leaf: boolean }> = [];
  const visit = (n: TreeNode | Leaf, parent: string | null, edge: 'yes' | 'no' | null) => {
    if (isLeaf(n)) { out.push({ id: n.id, parent, edge, label: n.label, leaf: true }); return; }
    out.push({ id: n.id, parent, edge, label: n.question, leaf: false });
    visit(n.yes, n.id, 'yes');
    visit(n.no, n.id, 'no');
  };
  visit(tree, null, null);
  return out;
}

export { CATEGORY_IDS };

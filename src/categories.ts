// The category taxonomy and the signals that point at each category.
//
// Signals are plain phrases matched on word boundaries (case-insensitive) or
// `re:` regular expressions. Weights: 1 = a hint, 2 = a strong word, 3 = close
// to decisive. Tune them here, never at the call site: the decision tree reads
// only the per-category totals these produce.

import type { Category, CategoryId, Features, Signal } from './types.ts';

const s = (weight: number, ...patterns: string[]): Signal[] => patterns.map((pattern) => ({ pattern, weight }));

export const CATEGORIES: readonly Category[] = [
  {
    id: 'coding', label: 'Coding', description: 'Write, fix, refactor or test code in a repository.',
    signals: [
      ...s(3, 'refactor', 'unit test', 'stack trace', 'fix the bug', 'failing test', 're:\\bimplement(s|ed|ing)?\\b'),
      ...s(2, 'function', 'bug', 'compile', 'typescript', 'python', 'rust', 'golang', 'java', 'api endpoint', 'regression',
        'cli', 'library', 'test suite', 'type error', 'lint', 'pull request', 'commit', 'migration', 'endpoint', 'sdk',
        're:\\.(ts|js|py|rs|go|java|kt|swift|rb|cs|cpp|c|h)\\b'),
      ...s(1, 'code', 'script', 'module', 'class', 'method', 'repo', 'repository', 'build', 'debug', 'feature'),
    ],
  },
  {
    id: 'webdev', label: 'Web dev', description: 'Build web apps, pages, routes, frontends and their APIs.',
    signals: [
      ...s(3, 'landing page', 'web app', 'website', 'next.js', 'nextjs', 'react component', 'single page app'),
      ...s(2, 'react', 'vue', 'svelte', 'tailwind', 'html', 'css', 'frontend', 'front-end', 'vite', 'route', 'web page',
        'browser', 'dom', 'responsive', 'astro', 'remix', 're:\\.(tsx|jsx|vue|svelte|html|css)\\b'),
      ...s(1, 'page', 'site', 'web', 'form', 'button', 'navbar'),
    ],
  },
  {
    id: 'ui-ux', label: 'UI / UX', description: 'Visual design, layout, interaction, accessibility and usability.',
    signals: [
      ...s(3, 'ui design', 'ux', 'user experience', 'wireframe', 'mockup', 'design system', 'figma', 'look and feel'),
      ...s(2, 'layout', 'typography', 'colour', 'color', 'palette', 'accessibility', 'a11y', 'usability', 'onboarding flow',
        'animation', 'dark mode', 'visual', 'spacing', 'icon', 'polish', 'beautiful', 'modern look', 'redesign', 'ui'),
      ...s(1, 'design', 'style', 'theme', 'screen', 'dashboard', 'interface'),
    ],
  },
  {
    id: 'infra', label: 'Infrastructure', description: 'Cloud, IaC, CI/CD, containers, Kubernetes, ops.',
    signals: [
      ...s(3, 'terraform', 'kubernetes', 'helm chart', 'cloudformation', 'ansible', 'docker compose', 'ci/cd', 'iac'),
      ...s(2, 'docker', 'k8s', 'kubectl', 'helm', 'aws', 'gcp', 'azure', 'cloudflare', 'nginx', 'systemd', 'deploy',
        'pipeline', 'github actions', 'load balancer', 'dns', 'vpc', 'cluster', 'devops', 'sre', 'monitoring',
        're:\\b(dockerfile|\\.tf|\\.ya?ml)\\b'),
      ...s(1, 'server', 'infra', 'infrastructure', 'linux', 'bash', 'cron', 'backup'),
    ],
  },
  {
    id: 'security', label: 'Cybersecurity', description: 'Scanning, pentest, hardening, threat modelling, incident prevention.',
    signals: [
      ...s(3, 'vulnerability', 'pentest', 'penetration test', 'security scan', 'threat model', 'cve', 'owasp', 'exploit',
        'security audit', 'secret scan', 'sast', 'dast'),
      ...s(2, 'security', 'xss', 'csrf', 'sql injection', 'hardening', 'firewall', 'malware', 'phishing', 'auth bypass',
        'encryption', 'leaked', 'secrets', 'zero trust', 'ctf', 'incident', 'intrusion', 'semgrep', 'trivy', 'checkov'),
      ...s(1, 'attack', 'breach', 'permission', 'token', 'audit'),
    ],
  },
  {
    id: 'data', label: 'Data / ML', description: 'Data analysis, SQL, notebooks, statistics, model training.',
    signals: [
      ...s(3, 'data analysis', 'machine learning', 'train a model', 'fine-tune', 'fine tune', 'regression model', 'etl'),
      ...s(2, 'sql', 'pandas', 'dataset', 'notebook', 'statistics', 'csv', 'dataframe', 'forecast', 'classifier',
        'embedding', 'pytorch', 'tensorflow', 'analytics', 'chart', 'visualisation', 'visualization'),
      ...s(1, 'data', 'metrics', 'query', 'table'),
    ],
  },
  {
    id: 'research', label: 'Research', description: 'Find, compare and synthesise information with sources.',
    signals: [
      ...s(3, 'research', 'literature review', 'state of the art', 'deep dive', 'find sources', 'compare options',
        'market research', 'competitor analysis', 'investigate'),
      ...s(2, 'compare', 'survey', 'find out', 'what is the best', 'benchmark', 'sources', 'citations', 'evidence',
        'summarise', 'summarize', 'report on', 'look up', 'leaderboard', 'paper', 'papers'),
      ...s(1, 'why', 'how does', 'overview', 'explain', 'analysis', 'trends'),
    ],
  },
  {
    id: 'seo', label: 'SEO', description: 'Search ranking, keywords, metadata, content for discovery.',
    signals: [
      ...s(3, 'seo', 'search engine optimisation', 'search engine optimization', 'keyword research', 'backlinks', 'serp'),
      ...s(2, 'meta description', 'sitemap', 'schema markup', 'structured data', 'organic traffic', 'ranking', 'keywords',
        'google search console', 'core web vitals', 'canonical'),
      ...s(1, 'traffic', 'search', 'blog post'),
    ],
  },
  {
    id: 'writing', label: 'Writing', description: 'Docs, copy, posts, emails, translation, editing.',
    signals: [
      ...s(3, 'write a blog', 'copywriting', 'press release', 'cover letter', 'newsletter', 'translate', 'proofread'),
      ...s(2, 'readme', 'documentation', 'copy', 'blog', 'article', 'email', 'linkedin post', 'tweet', 'essay', 'story',
        'tone', 'rewrite', 'edit', 'draft', 'script for'),
      ...s(1, 'write', 'words', 'text', 'post'),
    ],
  },
  {
    id: 'business', label: 'Business advisory', description: 'Strategy, pricing, finance, go-to-market, planning.',
    signals: [
      ...s(3, 'business plan', 'go-to-market', 'go to market', 'pricing strategy', 'pitch deck', 'unit economics',
        'business model', 'fundraising', 'valuation'),
      ...s(2, 'strategy', 'revenue', 'pricing', 'market', 'customers', 'competitors', 'startup', 'investor', 'roadmap',
        'okr', 'budget', 'profit', 'cash flow', 'sales', 'marketing', 'advisory', 'advise'),
      ...s(1, 'plan', 'growth', 'decision', 'priorities'),
    ],
  },
  {
    id: 'legal', label: 'Legal', description: 'Contracts, compliance, regulation, IP, legal research.',
    advisory: true,
    signals: [
      ...s(3, 'contract', 'legal', 'lawyer', 'gdpr', 'terms of service', 'privacy policy', 'trademark', 'patent', 'uspto',
        'lawsuit', 'compliance', 'nda', 'licence agreement', 'license agreement'),
      ...s(2, 'regulation', 'clause', 'liability', 'jurisdiction', 'copyright', 'statute', 'court', 'litigation',
        'employment law', 'hipaa', 'soc 2', 'soc2', 'eula', 'disclosure'),
      ...s(1, 'law', 'rights', 'policy', 'agreement'),
    ],
  },
  {
    id: 'health', label: 'Health advisory', description: 'Personal health, fitness, nutrition, symptoms — advisory only.',
    advisory: true,
    signals: [
      ...s(3, 'symptom', 'symptoms', 'diet plan', 'meal plan', 'workout plan', 'sleep', 'nutrition', 'blood pressure',
        'mental health', 'weight loss'),
      ...s(2, 'health', 'fitness', 'exercise', 'calories', 'doctor', 'pain', 'injury', 'supplement', 'stress', 'anxiety',
        'wellbeing', 'dietician', 'dietitian', 'coach'),
      ...s(1, 'healthy', 'body', 'energy'),
    ],
  },
  {
    id: 'biomed', label: 'Bio / medicine', description: 'Biology, medicine, pharmacology, clinical and life-science research.',
    advisory: true,
    signals: [
      ...s(3, 'clinical trial', 'protein', 'genome', 'genomics', 'pharmacology', 'drug discovery', 'crispr', 'pathology',
        'molecular', 'bioinformatics', 'diagnosis', 'pubmed'),
      ...s(2, 'medicine', 'medical', 'biology', 'clinical', 'disease', 'cell', 'dna', 'rna', 'enzyme', 'dosage',
        'treatment', 'patient', 'oncology', 'immunology', 'vaccine', 'biomarker'),
      ...s(1, 'bio', 'gene', 'health data'),
    ],
  },
  {
    id: 'image', label: 'Image generation', description: 'Generate or edit images, logos, illustrations.',
    modality: 'image',
    signals: [
      ...s(3, 'generate an image', 'generate image', 'create an image', 'illustration', 'logo', 'text-to-image',
        'image generation', 'edit this image', 'photo of', 'product shot', 'midjourney', 'dall-e'),
      ...s(2, 'image', 'picture', 'poster', 'banner', 'thumbnail', 'artwork', 'render an image', 'icon set'),
      ...s(1, 'photo', 'visual asset'),
    ],
  },
  {
    id: '3d', label: '3D modelling', description: 'Blender/CAD scripts, meshes, 3D scenes and shaders.',
    modality: 'mesh',
    signals: [
      ...s(3, 'blender', 'cadquery', '3d model', '3d modelling', '3d modeling', 'mesh', 'stl', 'openscad', 'three.js',
        'threejs', 'shader'),
      ...s(2, '3d', 'cad', 'gltf', 'obj file', 'webgl', 'render scene', 'printable', 'extrude'),
      ...s(1, 'geometry', 'scene'),
    ],
  },
  {
    id: 'general', label: 'General', description: 'Anything that matches no category strongly enough.',
    signals: [],
  },
];

export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((c) => c.id);

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function isCategoryId(id: unknown): id is CategoryId {
  return typeof id === 'string' && (CATEGORY_IDS as readonly string[]).includes(id);
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Compiled once. A phrase is bounded by non-word characters on both sides so
// `ui` does not fire inside `build` and `cell` does not fire inside `excellent`.
const COMPILED: Array<{ cat: CategoryId; pattern: string; weight: number; re: RegExp }> = CATEGORIES.flatMap((c) =>
  c.signals.map((sig) => ({
    cat: c.id,
    pattern: sig.pattern,
    weight: sig.weight,
    re: sig.pattern.startsWith('re:')
      ? new RegExp(sig.pattern.slice(3), 'gi')
      : new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(sig.pattern)}(?![\\p{L}\\p{N}_])`, 'giu'),
  })),
);

const EXPLICIT_RE = /\[(?:category|cat|route)\s*:\s*([a-z0-9-]+)\]|(?:^|\s)#(coding|webdev|ui-ux|ui|ux|infra|security|data|research|seo|writing|business|legal|health|biomed|image|3d)\b/i;

const ALIASES: Record<string, CategoryId> = { ui: 'ui-ux', ux: 'ui-ux', web: 'webdev', code: 'coding', bio: 'biomed', medicine: 'biomed', medical: 'biomed', devops: 'infra', sec: 'security', cyber: 'security' };

/**
 * Score a piece of text against every category. A signal counts once per
 * occurrence, capped at 3 occurrences, so pasting the same word 40 times does
 * not drown out everything else.
 */
export function extractFeatures(text: string): Features {
  const scores = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<CategoryId, number>;
  const hits = Object.fromEntries(CATEGORY_IDS.map((id) => [id, [] as string[]])) as Record<CategoryId, string[]>;
  const t = String(text || '');
  for (const sig of COMPILED) {
    sig.re.lastIndex = 0;
    const n = Math.min(3, (t.match(sig.re) || []).length);
    if (n > 0) {
      scores[sig.cat] += n * sig.weight;
      hits[sig.cat].push(n > 1 ? `${sig.pattern}×${n}` : sig.pattern);
    }
  }
  let explicit: CategoryId | null = null;
  const m = t.match(EXPLICIT_RE);
  if (m) {
    const raw = String(m[1] || m[2] || '').toLowerCase();
    const id = ALIASES[raw] || raw;
    if (isCategoryId(id)) explicit = id;
  }
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  return { scores, hits, explicit, words };
}

// How to run one prompt non-interactively on each agent CLI. Only argv arrays
// — never a shell string — so a prompt or model id can never be interpreted
// by a shell. Prompts go on stdin where the CLI supports it.
//
// Verified forms (2026-10): claude -p reads stdin; codex exec - reads stdin;
// agy / kimi / grok / vibe take the prompt as the -p argument. Auto-approve
// flags are the ones LaunchPad's fleet launcher uses (launch-provider.ts).

export interface CliInvocation {
  bin: string;
  args: string[];
  /** Prompt is written to stdin (otherwise it is already in args). */
  stdin: string | null;
}

export interface AdapterOptions {
  model?: string | null;
  /** Let the agent act without approval prompts (needed for unattended runs). */
  auto?: boolean;
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,79}$/;
const safeModel = (m?: string | null) => (m && MODEL_RE.test(m) ? m : null);

export const ADAPTERS: Record<string, { bin: string; build(prompt: string, o: AdapterOptions): CliInvocation }> = {
  claude: {
    bin: 'claude',
    build: (prompt, o) => ({
      bin: 'claude',
      args: ['-p', '--output-format', 'text', ...(o.auto ? ['--dangerously-skip-permissions'] : []), ...(safeModel(o.model) ? ['--model', o.model!] : [])],
      stdin: prompt,
    }),
  },
  codex: {
    bin: 'codex',
    build: (prompt, o) => ({
      bin: 'codex',
      args: ['exec', ...(o.auto ? ['--dangerously-bypass-approvals-and-sandbox'] : []), ...(safeModel(o.model) ? ['--model', o.model!] : []), '-'],
      stdin: prompt,
    }),
  },
  gemini: {
    bin: 'agy',
    build: (prompt, o) => ({
      bin: 'agy',
      args: [...(o.auto ? ['--dangerously-skip-permissions'] : []), ...(safeModel(o.model) ? ['--model', o.model!] : []), '-p', prompt],
      stdin: null,
    }),
  },
  kimi: {
    bin: 'kimi',
    build: (prompt, o) => ({
      bin: 'kimi',
      args: [...(o.auto ? ['--auto'] : []), ...(safeModel(o.model) ? ['--model', o.model!] : []), '-p', prompt],
      stdin: null,
    }),
  },
  grok: {
    bin: 'grok',
    build: (prompt, o) => ({
      bin: 'grok',
      args: [...(o.auto ? ['--always-approve'] : []), ...(safeModel(o.model) ? ['--model', o.model!] : []), '-p', prompt],
      stdin: null,
    }),
  },
  mistral: {
    bin: 'vibe',
    // vibe has no model flag; the caller sets VIBE_ACTIVE_MODEL in the env.
    build: (prompt, o) => ({ bin: 'vibe', args: [...(o.auto ? ['--yolo', '--trust'] : []), '-p', prompt], stdin: null }),
  },
  ollama: {
    bin: 'ollama',
    // ollama has no "default model": the route always names one (from `ollama list`).
    build: (prompt, o) => {
      if (!safeModel(o.model)) throw new Error('ollama needs a model (taken from `ollama list` at refresh)');
      return { bin: 'ollama', args: ['run', o.model!], stdin: prompt };
    },
  },
};

export function invocationFor(provider: string, prompt: string, o: AdapterOptions = {}): CliInvocation {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`no CLI adapter for provider "${provider}" (have: ${Object.keys(ADAPTERS).join(', ')})`);
  return a.build(prompt, o);
}

/** Env additions a provider needs (vibe takes its model from the environment). */
export function envFor(provider: string, model?: string | null): Record<string, string> {
  if (provider === 'mistral' && safeModel(model)) return { VIBE_ACTIVE_MODEL: model! };
  return {};
}

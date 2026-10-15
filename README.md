# taskrouter

Route each task to the model that is best at that kind of work, across every agent CLI you have installed. The decision is made by a visible decision tree and a scoring formula, never by a model.

```
$ taskrouter route "Redesign the settings page: typography, spacing and a dark-mode palette"
category  ui-ux
path      explicit:no → media:no → regulated:no → security:no → build:yes → ui:yes → leaf-ui
model     Claude Opus 5.5 via claude (--model opus5.5)  score 99.45  coverage 100%
rule      balanced: cheapest of 1 within 3 pts of top 99.45
fallback  GPT-5.6 Sol (codex, 57.18) · Claude Sonnet 5.5 (claude, 88.85) · …
decision  7ad129c219781a32  matrix a529910512dffe85
```

- **Deterministic.** The same task, matrix snapshot and policy always give the same decision, with the same id. Every number that went into it is in the output.
- **Multi-CLI.** It drives `claude`, `codex`, `agy` (Gemini / Antigravity), `kimi`, `grok`, `vibe` (Mistral) and `ollama` through a single interface. It only routes to CLIs it finds on your `PATH`.
- **Splits mixed tasks.** "Research X, then implement Y" becomes a research subtask on the best research model and a coding subtask on the best coding model. The coding subtask depends on the research one.
- **No hard-coded models.** The catalog is discovered from the leaderboards and from what each installed CLI reports it can run.
- **Daily data.** The scores come from public leaderboards (LMArena, Scale SEAL, Codesota), refreshed once a day. Your own run outcomes are added as a private benchmark.
- **Zero runtime dependencies in the core.** The core runs in Node, Deno, Bun, browsers and Cloudflare Workers. Refreshing needs `hyparquet`, an optional dependency, to read LMArena's parquet files.

## Install

```sh
npm i -g taskrouter            # Node ≥ 23.6 (runs the TypeScript sources directly)
taskrouter detect              # which agent CLIs are on PATH
taskrouter refresh             # pull today's leaderboards → ~/.taskrouter/snapshot.json
taskrouter route "your task"
taskrouter run "your task" --auto      # route, then execute (unattended)
```

Library:

```ts
import { route } from 'taskrouter';
import snapshot from 'taskrouter/snapshot' with { type: 'json' };

const d = route('Write a Terraform module for a VPC', snapshot, { policy: { available: ['claude', 'codex'] } });
d.category;                 // 'infra'
d.choice.chosen?.route;     // { provider: 'claude', model: 'opus5.5' }
d.trace;                    // every tree node visited, with the numbers it compared
d.subtasks;                 // [] or ordered subtasks with dependsOn
```

## How a decision is made

### 1. Signals

Each of the 16 categories has a list of weighted phrases. The categories are coding, webdev, ui-ux, infra, security, data, research, seo, writing, business, legal, health, biomed, image, 3d and general. Each phrase is weighted 1, 2 or 3 and must match a whole word. A phrase counts at most three times. The result is one number per category. See `src/categories.ts`.

### 2. The decision tree

The tree is data in `src/tree.ts`. Any UI can draw it from `flattenTree()`, and `taskrouter tree` prints it.

```
◆ Did the author tag a category ([category: x] or #x)?          → use it
◆ Is the output an image or a 3D model?                          → image | 3d
◆ Is it legal, health or bio-medical advice?                     → legal | health | biomed  (advisory flag)
◆ Is it security scanning, hardening or threat work?             → security
◆ Does it build or change software?
   ◆ Is the visual design / UX the main deliverable?             → ui-ux
   ◆ Is it infrastructure, deployment or CI/CD?                  → infra
   ◆ Is it a web frontend / web app?                             → webdev
   ■                                                             → coding | data
◆ Is it research, SEO, business advice or writing?               → research | seo | business | writing
■                                                                → general
```

The order of the questions is itself policy. Regulated advice is recognised even when the task also mentions code, so it gets the advisory flag. Security is checked before generic coding.

### 3. Where the models come from — nothing is hard-coded

No model name or version appears in the code. Each refresh *discovers* the catalog:

| What | From |
|---|---|
| which models exist | every name on the leaderboards, normalised (`claude-opus-5.5-max`, `Claude Opus 5.5`, `ForgeCode / Claude Opus 5.5` → one key) |
| which CLI can run them | the CLIs themselves: `agy models`, `grok models`, `~/.codex/models_cache.json`, `~/.kimi-code/config.toml`, `~/.vibe/config.toml`, `ollama list`; Claude Code has no list command, so a pattern rule routes the two newest versions of each Claude family to `claude --model <id>` |
| lineage (predecessor) | same family, next-lower parsed version |
| cost | family tier rules (fable/flagship > opus > pro > sonnet > flash/haiku/mini), never per version |

A model released tomorrow is routable on the next refresh with no code change. `taskrouter refresh` prints what each CLI reported.

### 4. Picking the model

```
score     = Σ wᵦ·vᵦ / Σ wᵦ          over the category's benchmarks that have data for this model
coverage  = (weight with data) / (weight with data for any model)
adjusted  = score × (0.5 + 0.5·coverage)
```

- `vᵦ` is the normalised benchmark value: percent as-is; arena ratings as `200 × expected win rate vs the board leader` (leader = 100, −31 points ≈ 91); share scores as a fraction of the leader.
- **Missing numbers:** a model with no number on a benchmark uses its predecessor's (flagged `inherited`) — new releases reach the CLIs before the boards.
- **Board noise — family supersession:** an older version of a family is dropped unless it beats the newest routable version by more than their combined confidence interval (`√(u_old² + u_new²)`, from the boards' published bounds). A 16-point Arena gap with ±24 error bars never picks last year's model.
- **Policy:** `balanced` (default) = cheapest within `margin` (3) points of the top, then newest; `quality` = highest score; `cost` = cheapest above `floor`. Advisory categories (legal, health, bio-medicine) use `advisoryObjective`, default `quality` — regulated advice is never cost-optimised.
- **Fallbacks:** the best candidate on a *different provider* first, then by score.

Category weights live in `DEFAULT_WEIGHTS` in `src/matrix.ts` (benchmark ids only — no models).

### 5. Splitting

1. The task is cut into bullet lines, sentences, and clauses ("…, then …", "… and write …").
2. Each clause is scored on its own.
3. Clauses are grouped by category. A category gets its own subtask only if its share of the strongest category's score is at least `splitShare`.
4. Subtasks run in stage order: research → decide (business/legal/health/biomed) → design (ui-ux) → build → verify (security) → publish (seo/writing). Each subtask depends on every subtask in an earlier stage.

## Data sources

| Benchmark(s) | Source | How it is read |
|---|---|---|
| WebDev, Agent, Text (coding, expert, hard, math, creative, legal, medicine, science, business, writing, software, instruction following, overall), Search, Document, Vision, Text-to-Image | LMArena's official [`lmarena-ai/leaderboard-dataset`](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) (latest split; style-controlled where available) | Parquet, read with `hyparquet` |
| SWE-bench Pro | [Scale SEAL](https://scale.com/leaderboard/swe_bench_pro_public) (fixed scaffold) | HTML rows |
| Terminal-Bench 2.0 (median across agents), SWE-bench Verified, GPQA Diamond | [Codesota](https://www.codesota.com) | HTML rows |
| `private:<category>` | Your own routed runs (`privateScores()`) | (ok+1)/(n+2), at least 3 runs |

Every refresh records, per source, whether it worked, how many rows it read, and which top-of-board names it could not match. A source that fails keeps yesterday's numbers, because the new scores are merged over the previous snapshot.

**Caveats.**
- Public boards measure models, not your repos. The private eval is how the router learns what works for you.
- Agent+model boards such as Terminal-Bench mix the scaffold into the score. That is why the median across agents is used.
- Infrastructure, 3D and security have no live leaderboard of their own, so they use proxies, mostly Terminal-Bench, coding and expert prompts. Weight `private` up for them once you have your own data.
- Image routes assume the CLI's image tool uses that vendor's image model (codex → GPT Image, agy → Nano Banana). Check this against your installed CLI.

## Private eval and audit trail

`taskrouter run` appends one JSON line per run to `.taskrouter/audit.jsonl` in the working directory. Each line holds the full decision plus the exit code and the provider/model each step actually used. To feed outcomes back in:

```ts
import { privateScores } from 'taskrouter';
import { refresh } from 'taskrouter/refresh';
const outcomes = auditLines.flatMap(l => l.results.map((r, i) => ({ model: l.decision.choice.chosen.model, category: l.decision.category, ok: r.exit === 0 })));
const { matrix } = await refresh({ previous, extraScores: privateScores(outcomes, today) });
```

## Embedding

- **LaunchPad** uses the core inside a Cloudflare Worker. "Task router (full auto)" is one of the provider choices, and a TaskRouter tab shows the tree, the decision log, the audit trail and the stats board.
- **Your own orchestrator:** call `route()`, then `invocationFor(provider, prompt, { model, auto })` from `taskrouter/cli-adapters`. It returns an argv array plus stdin; nothing is passed through a shell.

## License

MIT

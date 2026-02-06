<p align="center">
  <img src="./sloppy-logo.png" alt="Sloppy" width="400" />
</p>

<h3 align="center">AI code cleanup that doesn't stop after one pass.</h3>

<p align="center">
  <strong>Free scan. No API key. No config. Just add the action.</strong>
</p>

<p align="center">
  <a href="https://github.com/braedonsaunders/sloppy/stargazers"><img src="https://img.shields.io/github/stars/braedonsaunders/sloppy?style=flat&color=yellow" alt="GitHub Stars" /></a>
  <a href="https://github.com/braedonsaunders/sloppy/blob/main/LICENSE"><img src="https://img.shields.io/github/license/braedonsaunders/sloppy?color=blue" alt="License" /></a>
  <a href="https://github.com/marketplace/actions/sloppy"><img src="https://img.shields.io/badge/GitHub%20Action-Marketplace-blue?logo=github" alt="GitHub Marketplace" /></a>
  <a href="https://github.com/braedonsaunders/sloppy/actions"><img src="https://img.shields.io/github/actions/workflow/status/braedonsaunders/sloppy/ci.yml?label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/infrastructure_cost-$0-brightgreen" alt="$0 Infrastructure" />
</p>

<p align="center">
  <a href="#5-second-setup">Setup</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#what-sloppy-catches">Categories</a> &middot;
  <a href="#all-inputs">All Inputs</a> &middot;
  <a href="#all-outputs">All Outputs</a> &middot;
  <a href="#scoring">Scoring</a> &middot;
  <a href="#repo-config">Repo Config</a> &middot;
  <a href="#plugins">Plugins</a> &middot;
  <a href="#faq">FAQ</a>
</p>

---

## 5-Second Setup

```yaml
# .github/workflows/sloppy.yml
name: Sloppy
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      models: read
    steps:
      - uses: actions/checkout@v4
      - uses: braedonsaunders/sloppy@v1
```

That's it. No API key. No config file. No hosted service. You get a code quality score from 0 to 100 on every PR, posted as a comment.

Want auto-fixes too? Add an API key. [Jump to fix mode.](#fix-mode)

---

## Why Sloppy

Most tools scan once. Sloppy runs **multiple passes** -- it scans, fixes, re-scans, finds new issues exposed by the fixes, fixes those, and keeps going until the codebase is clean or the budget runs out.

| | Other tools | Sloppy |
|---|---|---|
| Passes | 1 | As many as it takes |
| Auto-fix | Maybe lint rules | AI logic fixes |
| Commits | One giant diff | One per issue (revertible) |
| Infrastructure | Their servers | Your GitHub Actions runner |
| Free tier | Limited | Unlimited scans (GitHub Models) |
| Cost | Their pricing | Your API key, your spend cap |
| Hosting | Yes | No. Git is the database. |

---

## How It Works

### Scan Mode (free, no API key)

Uses the **GitHub Models free tier** to analyze your code. Every GitHub user has access.

**What you get:**
- Score from 0-100 on every PR
- PR comment with issue breakdown
- History tracking in `.sloppy/history.json`
- Badge support via shields.io + gist
- HTML dashboard at `.sloppy/site/index.html`

**Three-layer scanning pipeline:**

| Layer | What | Cost |
|-------|------|------|
| Layer 0 | Local regex analysis (hardcoded secrets, SQL injection, stubs, empty catches) | Zero API calls |
| Layer 1 | AI scan via GitHub Models. ≤15 files: deep scan with full content. >15 files: fingerprint scan (compact ~100 token/file representations) | Free tier |
| Layer 2 | SHA256 file caching -- unchanged files are skipped entirely on repeat scans | Zero API calls |

**PR scan + weekly full scan:**

```yaml
name: Sloppy
on:
  pull_request:
  schedule:
    - cron: '0 6 * * 1'
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      models: read
    steps:
      - uses: actions/checkout@v4
      - uses: braedonsaunders/sloppy@v1
        with:
          scan-scope: auto
```

`scan-scope: auto` scans only PR-changed files on `pull_request`, full repo otherwise.

### Fix Mode

Bring your own API key. Sloppy uses **Claude Code CLI** or **OpenAI Codex CLI** to find and fix issues, then opens a PR with atomic commits.

> Run this as a **separate workflow file** from scan. Scan is fast and free (every PR). Fix is slow and costs money (on-demand or scheduled).

**With Claude (recommended):**

```yaml
# .github/workflows/sloppy-fix.yml
name: Sloppy Fix
on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:
jobs:
  fix:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: braedonsaunders/sloppy@v1
        with:
          mode: fix
          agent: claude
          timeout: 30m
          max-cost: '$5.00'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

**With OpenAI Codex:**

```yaml
      - uses: braedonsaunders/sloppy@v1
        with:
          mode: fix
          agent: codex
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

**With Claude Max subscription (OAuth):**

If you have Claude Max ($100-200/month), use your subscription instead of pay-per-token:

```bash
claude setup-token
```

Store the token as `CLAUDE_CODE_OAUTH_TOKEN` secret, then:

```yaml
      - uses: braedonsaunders/sloppy@v1
        with:
          mode: fix
          agent: claude
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Tokens from `claude setup-token` are long-lived (~1 year). Subject to Max plan rate limits (5-hour rolling window + weekly ceiling).

### Fix Loop Architecture

```
PASS 1 → SCAN → CLUSTER issues by directory → DISPATCH agents → TEST → COMMIT per fix
PASS 2 → RE-SCAN (fixes reveal new issues) → CLUSTER → DISPATCH → TEST → COMMIT
PASS N → RE-SCAN → nothing found × min-passes → DONE
```

- **Atomic commits** -- one per fix, prefixed (`fix:`, `style:`, `chore:`, `refactor:`, `test:`)
- **Test verification** -- auto-detects your test runner, reverts failed fixes
- **Issue clustering** -- groups issues by directory, dispatches per cluster
- **Parallel agents** -- up to 8 via git worktrees (`parallel-agents: 4`)
- **Self-chaining** -- checkpoints progress, triggers a new run if approaching the 6h GitHub Actions limit. Up to 3 chains = 18 hours total.
- **Budget control** -- stops when `max-cost` is hit

---

## What Sloppy Catches

Eight categories:

| Category | Examples |
|---|---|
| **security** | SQL injection, XSS, hardcoded secrets, auth bypass, path traversal, insecure crypto, `eval()` on user input, `os.system()`, `dangerouslySetInnerHTML` |
| **bugs** | Null dereferences, off-by-one, race conditions, wrong logic, empty catch blocks, swallowed errors |
| **types** | TypeScript errors, unsafe casts, `any` abuse, wrong generics, missing type annotations |
| **lint** | Unused variables/imports, naming conventions, missing returns, import order |
| **dead-code** | Unused exports, unreachable functions, orphaned files, commented-out blocks |
| **stubs** | `TODO`, `FIXME`, `HACK`, `NotImplementedError`, `throw new Error("not implemented")`, placeholder implementations |
| **duplicates** | Copy-pasted logic, redundant utility functions, repeated patterns |
| **coverage** | Untested code paths, missing edge cases, missing test files |

Disable any category: `fix-types: 'security,bugs,types'`

---

## All Inputs

Every input is optional. Sloppy works with zero configuration.

| Input | Default | Description |
|---|---|---|
| `github-token` | `${{ github.token }}` | GitHub token for API access and GitHub Models |
| `mode` | *(auto)* | `scan` (report only) or `fix` (auto-fix + PR). Auto-selects `fix` if an API key env var is set, otherwise `scan`. |
| `agent` | `claude` | AI agent: `claude` or `codex` |
| `timeout` | `30m` | Max run time. Supports `30m`, `2h`, `5h50m`, `90s`. |
| `max-cost` | `$5.00` | Max API spend per run |
| `max-passes` | `10` | Max scan/fix passes before stopping |
| `min-passes` | `2` | Minimum consecutive clean passes to confirm the repo is truly clean |
| `max-chains` | `3` | Max self-continuations for long runs (each chain gets up to 6h) |
| `strictness` | `high` | Issue detection: `low`, `medium`, `high` |
| `fix-types` | `security,bugs,types,lint,dead-code,stubs,duplicates,coverage` | Comma-separated issue types to scan/fix |
| `model` | *(auto)* | Override AI model for fix mode (e.g. `claude-sonnet-4-5-20250929`) |
| `github-models-model` | `openai/gpt-4o-mini` | Model for scan via GitHub Models. Free: `openai/gpt-4o-mini`. Premium: `openai/gpt-4o`, `openai/o1-mini` |
| `scan-scope` | `auto` | `auto` (PR files on `pull_request`, full otherwise), `pr` (PR changed files only), `full` (entire repo) |
| `test-command` | *(auto-detected)* | Custom test command. Auto-detects from your project (see below). |
| `gist-id` | *(empty)* | GitHub Gist ID for dynamic badge updates |
| `gist-token` | *(empty)* | PAT with `gist` scope for writing badge data |
| `fail-below` | `0` | Fail the action if score drops below this threshold |
| `verbose` | `false` | Stream agent output to Actions log in real-time |
| `max-turns` | *(auto)* | Max agent turns per invocation. Default: 30 for scan, 15 for fix. |
| `max-issues-per-pass` | `0` | Cap issues to fix per pass. 0 = unlimited. |
| `output-file` | *(empty)* | Write full issues JSON to this path (e.g. `.sloppy/issues.json`) |
| `custom-prompt` | *(empty)* | Custom instructions injected into every scan/fix prompt (inline text) |
| `custom-prompt-file` | *(empty)* | Path to a file containing custom prompt instructions (relative to repo root) |
| `plugins` | `true` | Enable/disable the plugin system (loads from `.sloppy/plugins/`) |
| `parallel-agents` | `1` | Number of parallel agents for fixing (1-8). Uses git worktrees. |
| `chain_number` | `0` | Internal: chain continuation number (do not set manually) |

### Auto-Detected Test Commands

If `test-command` is not set, Sloppy detects your test runner:

| File detected | Command run |
|---|---|
| `package.json` (with test script) | `npm test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pytest.ini` or `pyproject.toml` | `python -m pytest` |
| `build.gradle` or `build.gradle.kts` | `./gradlew test` |
| `pom.xml` | `mvn test` |
| `Gemfile` + `spec/` | `bundle exec rspec` |
| `Gemfile` + `test/` | `bundle exec rake test` |
| `phpunit.xml` or `phpunit.xml.dist` | `vendor/bin/phpunit` |
| `mix.exs` | `mix test` |
| `Makefile` | `make test` |

If nothing is detected, fixes proceed without test verification.

---

## All Outputs

Use these in subsequent workflow steps via `${{ steps.sloppy.outputs.score }}`.

| Output | Description |
|---|---|
| `score` | Code quality score (0-100) |
| `score-before` | Score before fixes (fix mode only) |
| `issues-found` | Total issues detected |
| `issues-fixed` | Total issues fixed (fix mode only) |
| `pr-url` | URL of the created pull request (fix mode only) |
| `summary-url` | URL to the Job Summary with full results |
| `output-file` | Path to the issues JSON file (if `output-file` was configured) |

---

## Scoring

**Formula:** `Score = 100 - (totalPenalty / KLOC)` clamped to 0-100.

KLOC = thousands of non-blank lines of code across scanned files.

**Severity weights:**

| Severity | Points deducted per issue | Examples |
|---|---|---|
| `critical` | 10 | Data loss, auth bypass, RCE, credential leak |
| `high` | 5 | Bugs causing crashes, data corruption, type violations |
| `medium` | 2 | Code smells, dead code, lint issues |
| `low` | 1 | Style, minor improvements |

**Score grades:**

| Score | Grade | Badge color | Meaning |
|---|---|---|---|
| 90-100 | A | Bright green | Clean. Ship it. |
| 70-89 | B | Green | Solid. Minor issues only. |
| 50-69 | C | Yellow | Needs attention. |
| 30-49 | D | Orange | Significant problems. |
| 0-29 | F | Red | Critical issues. Do not ship. |

**Strictness levels:**

| Level | Catches | Best for |
|---|---|---|
| `low` | Critical security, crash-causing bugs | Quick CI gate |
| `medium` | + type errors, lint violations, dead code | Regular maintenance |
| `high` | + stubs, duplicates, style issues, coverage gaps | Production readiness |

### CI Gate

```yaml
- uses: braedonsaunders/sloppy@v1
  with:
    fail-below: '70'
```

If score drops below 70, the action fails and blocks the PR.

---

## Repo Config

Create `.sloppy.yml` (or `.sloppy.yaml`, `.sloppy/config.yml`, `.sloppy/config.yaml`) in your repo root:

```yaml
ignore:
  - "**/*.test.ts"
  - "vendor/"

rules:
  lint: medium        # Override severity (critical, high, medium, low)
  dead-code: off      # Disable entirely

fix-types:
  - security
  - bugs

test-command: "npm run test:ci"
strictness: high
fail-below: 70
```

| Key | Type | Description |
|---|---|---|
| `ignore` | `string[]` | Glob patterns to exclude from scanning/fixing |
| `rules` | `Record<type, severity \| 'off'>` | Per-type severity overrides. `off` disables the type. |
| `fix-types` | `IssueType[]` | Which issue types to auto-fix |
| `test-command` | `string` | Override test runner |
| `strictness` | `low \| medium \| high` | Issue detection strictness |
| `fail-below` | `number` | Minimum passing score (0-100) |

Repo config overrides action.yml defaults but **not** explicit user inputs.

---

## Plugins

Plugins live in `.sloppy/plugins/`. Two layouts:

```
.sloppy/plugins/my-plugin/plugin.yml   # directory plugin
.sloppy/plugins/rules.yml              # single-file plugin
```

### Plugin manifest (`plugin.yml`)

```yaml
name: my-rules
description: Custom code patterns

prompt: |
  Additional scanning instructions injected into every prompt...

patterns:
  - regex: 'mySecretPattern'
    type: security
    severity: critical
    description: "Custom secret detected"
    extensions: [.ts, .js]

hooks:
  pre-scan: ./scripts/setup.sh
  post-scan: ./scripts/report.sh
  pre-fix: ./scripts/before-fix.sh
  post-fix: ./scripts/cleanup.sh

filters:
  exclude-paths:
    - "**/*.test.ts"
    - "generated/"
  exclude-types:
    - lint
  min-severity: high
```

| Section | What it does |
|---|---|
| `prompt` | Custom text injected into every scan/fix AI prompt |
| `patterns` | Regex patterns for Layer 0 local scanning (no API calls) |
| `hooks` | Shell commands run at lifecycle points (paths relative to plugin dir) |
| `filters` | Exclude issues by path glob, type, or minimum severity |

Custom prompts can also come from:
- `custom-prompt` input (inline text)
- `custom-prompt-file` input (path to file)
- `.sloppy/prompt.md` convention file

All sources are composed together.

---

## Badge Setup

### 1. Create a public GitHub Gist

Create a gist with a file named `sloppy-badge.json`. Content doesn't matter -- Sloppy overwrites it.

### 2. Create a PAT with `gist` scope

Add it as a repository secret named `GIST_TOKEN`.

### 3. Configure the action

```yaml
- uses: braedonsaunders/sloppy@v1
  with:
    gist-id: 'your-gist-id-here'
    gist-token: ${{ secrets.GIST_TOKEN }}
```

### 4. Add the badge to your README

```markdown
![Sloppy Score](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/YOUR_USERNAME/YOUR_GIST_ID/raw/sloppy-badge.json)
```

---

## Dashboard & History

**Job Summary:** Every run writes results to the GitHub Actions Job Summary tab. No setup required.

**Score history:** Tracked in `.sloppy/history.json` inside your repo. Git is the database.

**HTML dashboard:** Auto-generated at `.sloppy/site/index.html`. Upload as artifact or serve via GitHub Pages:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: sloppy-dashboard
    path: .sloppy/site/
```

---

## Supported Languages

**File extensions scanned:**

`.ts` `.tsx` `.js` `.jsx` `.py` `.rb` `.go` `.rs` `.java` `.c` `.cpp` `.h` `.hpp` `.cs` `.php` `.swift` `.kt` `.scala` `.vue` `.svelte` `.html` `.css` `.scss` `.sql` `.sh` `.yaml` `.yml` `.json` `.toml` `.xml` `.dockerfile`

**Ignored directories:**

`node_modules` `.git` `dist` `build` `out` `.next` `vendor` `__pycache__` `.venv` `venv` `target` `coverage` `.sloppy`

---

## Environment Variables

| Variable | Required | Mode | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | Auto-provided | Both | GitHub API access + GitHub Models free tier |
| `ANTHROPIC_API_KEY` | For Claude fix | Fix | Anthropic API key. Triggers fix mode if set. |
| `CLAUDE_CODE_OAUTH_TOKEN` | For Claude Max fix | Fix | Claude Max subscription OAuth token (alternative to API key) |
| `OPENAI_API_KEY` | For Codex fix | Fix | OpenAI API key (when using `agent: codex`) |

GitHub Actions also auto-provides `GITHUB_WORKSPACE`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_NUMBER`, and `GITHUB_REF_NAME`.

---

## Generated Files

| Path | What | When |
|---|---|---|
| `.sloppy/history.json` | Score history (JSON array of run entries) | Every run |
| `.sloppy/site/index.html` | Standalone HTML dashboard with charts | Every run |
| `.sloppy/state.json` | Checkpoint for chained runs | Fix mode |
| `.sloppy/scan-cache.json` | SHA256 file hashes + cached issues | Scan mode |
| `output-file` path | Full issues JSON export | If `output-file` is set |

---

## Recommended Setup

Two workflow files:

```
.github/workflows/sloppy.yml       # Free scan on every PR
.github/workflows/sloppy-fix.yml   # Fix on-demand or weekly (BYOK)
```

They stay independent. Scan never triggers fix. Fix never blocks PRs.

---

## FAQ

**Is the free scan actually free?**
Yes. GitHub Models free tier. No API key, no secrets, no cost. The `models: read` permission grants access.

**What's scan vs fix mode?**
Scan reports a score. Fix uses an AI agent (Claude Code or OpenAI Codex) to find and fix issues, then opens a PR with atomic commits. They should be separate workflow files.

**Will fix mode break my code?**
Every fix runs through your test suite. Failed fixes are reverted. Each fix is a single atomic commit -- `git revert <sha>` any one of them. Sloppy works on its own branch and opens a PR.

**Why multi-pass?**
Fixing issue A often reveals issue B. Dead code becomes reachable after a refactor. Type errors surface after removing `any` casts. One pass gives a partial picture.

**What if a run hits the 6-hour GitHub Actions limit?**
Sloppy checkpoints to `.sloppy/state.json` and triggers a new workflow run. Up to `max-chains` continuations (default 3 = 18h total).

**How much does fix mode cost?**
Depends on codebase size and issues found. `max-cost` (default `$5.00`) caps spending. Typical medium repo: $1-3 per fix run. Or use Claude Max subscription for flat-rate.

**Where is the data stored?**
In your repo. History in `.sloppy/history.json`. Badge data in a Gist you control. Dashboard is a static HTML page. No external database, no third-party server, no telemetry.

**Does the author host anything?**
No. Zero infrastructure. No servers, no databases, no SaaS. The action runs on your GitHub Actions runner with your API keys.

**What languages?**
Scan works with any language supported by GitHub Models. Fix supports whatever Claude Code or OpenAI Codex can handle. 30+ file extensions scanned (see [Supported Languages](#supported-languages)).

---

## Contributing

```bash
git clone https://github.com/braedonsaunders/sloppy.git
cd sloppy
npm install
npm run build      # → dist/index.js (bundled via @vercel/ncc)
npm run typecheck   # tsc --noEmit
```

---

## License

[MIT](LICENSE)

---

<p align="center">
  <strong>Every other tool does one pass. Sloppy doesn't stop.</strong>
</p>

<p align="center">
  <a href="https://github.com/braedonsaunders/sloppy">Star the repo</a> if you think code cleanup should be relentless.
</p>

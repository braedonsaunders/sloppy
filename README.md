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

#### Agent-powered scan

Want higher quality scans using the same AI model as fix mode? Set `scan-provider: agent` to use Claude or Codex for scanning instead of the GitHub Models free tier. Requires an API key.

```yaml
# .sloppy.yml
scan-provider: agent    # use fix-mode agent for scans
agent: claude            # claude | codex
model: ""                # optional model override
```

Or in the workflow:

```yaml
- uses: braedonsaunders/sloppy@v1
  with:
    mode: scan
    scan-provider: agent
    agent: claude
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

| Provider | Cost | Quality | Speed |
|---|---|---|---|
| `github-models` (default) | Free | Good (GPT-4o-mini) | Fast (~20s) |
| `agent` | Your API key | Higher (Claude/GPT-4o) | Slower (~60s) |

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

## Outputs

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

`.sloppy.yml` is the **single source of truth** for all non-secret settings. Create it in your repo root (or at `.sloppy.yaml`, `.sloppy/config.yml`, `.sloppy/config.yaml`):

```yaml
# ──────────────────────────────────────────────
# .sloppy.yml — Complete configuration reference
# ──────────────────────────────────────────────

# ── Operational ───────────────────────────────
mode: scan                          # scan | fix
agent: claude                       # claude | codex
timeout: 30m                        # e.g. 30m, 2h, 5h50m, 90s
max-cost: "$5.00"                   # max API spend per run
max-passes: 10                      # max scan/fix iterations
min-passes: 2                       # consecutive clean passes to confirm clean
max-chains: 3                       # max self-continuations (6h each)
model: ""                           # override AI model (e.g. claude-sonnet-4-5-20250929)
github-models-model: openai/gpt-4o-mini  # model for free scan tier
scan-scope: auto                    # auto | pr | full
scan-provider: github-models        # github-models (free) | agent (uses fix-mode provider)
verbose: false                      # stream agent output to logs
max-turns: 30                       # max agent turns per invocation
max-issues-per-pass: 0              # 0 = unlimited
output-file: ""                     # path for full issues JSON export
parallel-agents: 1                  # 1-8, uses git worktrees
plugins: true                       # enable/disable plugin system
custom-prompt: ""                   # inline custom prompt text
custom-prompt-file: ""              # path to prompt file

# ── Filtering ─────────────────────────────────
strictness: high                    # low | medium | high
min-severity: low                   # critical | high | medium | low
                                    #   Only report/fix issues at or above this level
                                    #   Example: "high" → only critical + high issues
fail-below: 0                       # fail action if score drops below this (0 = disabled)
test-command: "npm run test:ci"     # override auto-detected test runner

fix-types:                          # which issue types to scan/fix
  - security
  - bugs
  - types
  - lint
  - dead-code
  - stubs
  - duplicates
  - coverage

ignore:                             # glob patterns to exclude
  - "**/*.test.ts"
  - "vendor/"
  - "generated/"

rules:                              # per-type severity overrides
  lint: medium                      #   critical | high | medium | low
  dead-code: off                    #   'off' disables the type entirely

# ── App Context ───────────────────────────────
# Tells the AI about your application so it can calibrate severity.
# A hardcoded localhost URL in a CLI tool is not a security issue.
# An unauthenticated endpoint behind a VPN is different from a public API.
app:
  type: web-app                     # web-app | api | cli | library | worker | mobile | desktop
  exposure: public                  # public | internal | local
  auth: true                        # has authentication layer
  network: internet                 # internet | vpn | localhost
  data-sensitivity: high            # high | medium | low (PII, financial, public data)

# ── Technology Context ────────────────────────
framework: next.js                  # helps AI understand framework-specific patterns
runtime: node-20                    # runtime version hint

# ── Trust Boundaries ──────────────────────────
trust-internal:                     # packages to treat as first-party (don't flag imports)
  - "@myorg/*"
  - "@mycompany/shared-utils"

trust-untrusted:                    # files that handle external/user input (stricter scrutiny)
  - "src/api/routes/*"
  - "src/webhooks/*"

# ── False Positive Suppressions ───────────────
# Patterns matching issue descriptions or file paths are suppressed.
allow:
  - pattern: "eval\\("
    reason: "Used in build-time template engine, not user input"
  - pattern: "dangerouslySetInnerHTML"
    reason: "Content is sanitized by DOMPurify upstream"
```

Every action input (the `with:` block in your workflow YAML) maps 1:1 to a key in this file. The only action-specific input is `github-token` (defaults to `${{ github.token }}`). Repo config overrides action defaults but **not** explicit workflow inputs. Priority:

1. Explicit action input (in workflow YAML) — highest
2. Profile overlay (`.sloppy/profiles/<name>.yml`)
3. `.sloppy.yml` base config
4. Action defaults — lowest

### App context and severity calibration

The `app` block gives the AI real context about your application. This changes how it grades severity:

| Scenario | Without context | With `exposure: local` |
|---|---|---|
| Hardcoded localhost URL | `medium` security issue | Not flagged |
| SSRF via user input | `critical` | `low` (no network access) |
| Missing CSRF token | `high` | `low` (local only) |
| SQL injection | `critical` | Still `critical` (data integrity) |

### min-severity examples

```yaml
# Only fix critical and high severity issues — ignore medium and low
min-severity: high

# Only fix critical issues (security emergencies)
min-severity: critical
```

This is a pure output filter. The scanner still *finds* all issues internally, but issues below your threshold are dropped before reporting and fixing.

### Auto-detected test commands

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

### Profiles

Profiles let you use different settings for different contexts. Create profile files in `.sloppy/profiles/`:

```
.sloppy/profiles/ci.yml       # Strict settings for CI
.sloppy/profiles/local.yml    # Relaxed settings for local dev
.sloppy/profiles/security.yml # Security-only audit
```

Each profile file uses the **same format** as `.sloppy.yml`. Profile values override the base config.

**Example: `.sloppy/profiles/ci.yml`**
```yaml
strictness: high
fail-below: 80
min-severity: medium
```

**Example: `.sloppy/profiles/security.yml`**
```yaml
fix-types:
  - security
min-severity: high
strictness: high
```

Activate a profile via the action input:
```yaml
- uses: braedonsaunders/sloppy@v1
  with:
    profile: ci
```

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

## Dashboard, History & Generated Files

**Job Summary:** Every run writes results to the GitHub Actions Job Summary tab. No setup required.

**Score history:** Tracked in `.sloppy/history.json` inside your repo. Git is the database.

**HTML dashboard:** Auto-generated at `.sloppy/site/index.html`. Upload as artifact or serve via GitHub Pages:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: sloppy-dashboard
    path: .sloppy/site/
```

**Generated files:**

| Path | When |
|---|---|
| `.sloppy/history.json` | Every run — score history |
| `.sloppy/site/index.html` | Every run — HTML dashboard |
| `.sloppy/state.json` | Fix mode — checkpoint for chained runs |
| `.sloppy/scan-cache.json` | Scan mode — SHA256 file hashes + cached issues |

---

## Supported Languages

**30+ file extensions scanned:** `.ts` `.tsx` `.js` `.jsx` `.py` `.rb` `.go` `.rs` `.java` `.c` `.cpp` `.h` `.hpp` `.cs` `.php` `.swift` `.kt` `.scala` `.vue` `.svelte` `.html` `.css` `.scss` `.sql` `.sh` `.yaml` `.yml` `.json` `.toml` `.xml` `.dockerfile`

**Auto-ignored directories:** `node_modules` `.git` `dist` `build` `out` `.next` `vendor` `__pycache__` `.venv` `venv` `target` `coverage` `.sloppy`

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
Any language supported by GitHub Models (scan) or Claude Code / OpenAI Codex (fix). See [Supported Languages](#supported-languages).

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

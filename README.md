<p align="center">
  <img src="./sloppy-logo.png" alt="Sloppy" width="400" />
</p>

<h3 align="center">The GitHub Action that relentlessly cleans your code using AI.</h3>

<p align="center">
  Free scan. No API key. No config. Just add the action.
</p>

<p align="center">
  <a href="https://github.com/braedonsaunders/sloppy/stargazers"><img src="https://img.shields.io/github/stars/braedonsaunders/sloppy?style=flat&color=yellow" alt="GitHub Stars" /></a>
  <a href="https://github.com/braedonsaunders/sloppy/blob/main/LICENSE"><img src="https://img.shields.io/github/license/braedonsaunders/sloppy?color=blue" alt="License" /></a>
  <a href="https://github.com/marketplace/actions/sloppy"><img src="https://img.shields.io/badge/GitHub%20Action-Marketplace-blue?logo=github" alt="GitHub Marketplace" /></a>
  <a href="https://github.com/braedonsaunders/sloppy/actions"><img src="https://img.shields.io/github/actions/workflow/status/braedonsaunders/sloppy/ci.yml?label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/infrastructure_cost-$0-brightgreen" alt="$0 Infrastructure" />
</p>

<p align="center">
  <a href="#tldr">TLDR</a> &middot;
  <a href="#why-sloppy">Why Sloppy</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#configuration-reference">Configuration</a> &middot;
  <a href="#the-sloppy-score">Scoring</a> &middot;
  <a href="#faq">FAQ</a>
</p>

---

## TLDR

Add four lines to your repo. Get a code quality score on every push. Free.

```yaml
name: Sloppy
on: [push, pull_request]
jobs:
  sloppy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      models: read
    steps:
      - uses: actions/checkout@v4
      - uses: braedonsaunders/sloppy@v1
```

That's it. No API key. No config file. No hosted service. Sloppy uses the GitHub Models free tier to scan your repo and report a score from 0 to 100. It posts the results as a PR comment, updates a badge, and tracks history over time -- all inside your repo.

Want it to actually *fix* the issues? Bring your own API key and turn on fix mode. Keep reading.

---

## What You Get

On every pull request, Sloppy drops a comment like this:

```
Sloppy Score: 72 / 100  (was 68)

  CATEGORY        ISSUES    DELTA
  security           0       -2
  bugs               3       -1
  types              5        0
  lint              12       -4
  dead-code          4        0
  stubs              2       -1
  duplicates         1        0
  coverage          38%     +3%

  8 issues fixed since last run.
  3 new issues introduced in this PR.

  Full history: https://yourname.github.io/yourrepo/
```

In fix mode, you also get a PR with atomic commits -- one commit per fix, each independently revertible.

---

## Why Sloppy

**Every other tool does one pass. Sloppy doesn't stop.**

Most linters and AI code review tools scan your code once, dump a report, and call it a day. Sloppy runs multiple passes. It scans, fixes, re-scans, finds new issues exposed by the fixes, fixes those, and keeps going until the codebase is actually clean or the budget runs out.

Here is what makes it different:

| Feature | Other tools | Sloppy |
|---|---|---|
| Scan passes | 1 | As many as it takes |
| Auto-fix | Maybe lint rules | AI-powered logic fixes |
| Commit style | One giant diff | One commit per issue |
| Infrastructure | Their servers | Your GitHub Actions runner |
| Free tier | Limited | Unlimited scans via GitHub Models |
| Cost to run | Their pricing page | Your API key, your spend cap |
| Hosting required | Yes | No. Git is the database. |

Other things worth knowing:

- **Self-chaining.** If a fix run hits the GitHub Actions 6-hour job limit, Sloppy checkpoints its progress and spawns a new workflow run to continue where it left off. Set `max-chains: 3` and it can run for up to 18 hours across multiple jobs.

- **Atomic commits.** Every fix is a single commit with a clear message. Don't like a fix? `git revert <sha>`. Done. No untangling a 40-file diff.

- **Dashboard via GitHub Pages.** Sloppy writes `history.json` to a `.sloppy/` directory in your repo. Point GitHub Pages at it and you get a score dashboard. Zero hosting.

- **Dynamic badge.** Wire up a GitHub Gist and shields.io and your README badge updates on every run. Green when clean, red when not.

- **$0 infrastructure.** The creator hosts nothing. There is no server, no database, no SaaS. You bring your own API key. Sloppy runs on your GitHub Actions minutes. That's it.

---

## How It Works

Sloppy operates in three tiers. Pick the one that fits.

### Tier 1: Free Scan (no API key)

Sloppy uses the **GitHub Models free tier** (available to all GitHub users) to scan your code and produce a score. No API key, no secrets, no cost.

What you get:
- Score from 0 to 100 on every push
- PR comments showing the score and issue breakdown
- History tracking in `.sloppy/history.json`
- Badge support via shields.io + gist

What you don't get:
- Auto-fixes (that requires an AI agent with more capability than the free tier provides)

```yaml
name: Sloppy
on: [push, pull_request]
jobs:
  sloppy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      models: read
    steps:
      - uses: actions/checkout@v4
      - uses: braedonsaunders/sloppy@v1
```

### Tier 2: BYOK Fix (API key)

Bring your own Anthropic or OpenAI API key. Sloppy uses **Claude Code CLI** or **OpenAI Codex CLI** to find and fix issues, then opens a PR with atomic commits.

**With Claude (recommended):**

```yaml
name: Sloppy Fix
on:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch:
jobs:
  sloppy:
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

### Tier 3: Claude Max Subscription (OAuth)

If you have a Claude Max subscription, you can use your OAuth token instead of a metered API key. Same capabilities, subscription pricing.

```yaml
      - uses: braedonsaunders/sloppy@v1
        with:
          mode: fix
          agent: claude
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

---

## What Sloppy Catches

Eight analysis categories, all running in parallel:

| Category | What it finds |
|---|---|
| **security** | SQL injection, XSS, hardcoded secrets, dependency vulnerabilities, OWASP Top 10 |
| **bugs** | Null references, unreachable code, off-by-one errors, race conditions |
| **types** | TypeScript errors, missing type annotations, `any` abuse, incorrect generics |
| **lint** | ESLint violations, formatting issues, import order, naming conventions |
| **dead-code** | Unused exports, unreachable functions, orphaned files, commented-out blocks |
| **stubs** | `TODO`, `FIXME`, `HACK`, empty function bodies, placeholder implementations |
| **duplicates** | Copy-pasted logic, redundant utility functions, repeated patterns |
| **coverage** | Untested code paths, missing test files, low branch coverage |

You can enable or disable any category with the `fix-types` input.

---

## Configuration Reference

All inputs are optional. Sloppy works with zero configuration.

| Input | Default | Description |
|---|---|---|
| `mode` | *(empty = scan)* | `scan` (report only) or `fix` (auto-fix + PR) |
| `agent` | `claude` | AI agent: `claude` or `codex` |
| `timeout` | `30m` | Max run time. Accepts `30m`, `2h`, `5h50m`. |
| `max-cost` | `$5.00` | Max API spend per run. Sloppy stops when the budget is hit. |
| `max-passes` | `10` | Max scan/fix passes before stopping |
| `min-passes` | `2` | Minimum consecutive clean passes to confirm the repo is truly clean |
| `max-chains` | `3` | Max self-continuations for long runs (each chain gets up to 6h) |
| `strictness` | `high` | Issue detection strictness: `low`, `medium`, `high` |
| `fix-types` | `security,bugs,types,lint,dead-code,stubs,duplicates,coverage` | Comma-separated list of issue types to scan and fix |
| `model` | *(auto)* | Override the AI model (e.g. `claude-sonnet-4-5-20250929`) |
| `github-models-model` | `openai/gpt-4o` | Model to use for free scan tier via GitHub Models |
| `test-command` | *(auto-detected)* | Custom test command. Sloppy auto-detects `npm test`, `pytest`, etc. |
| `gist-id` | *(empty)* | GitHub Gist ID for dynamic badge updates |
| `gist-token` | *(empty)* | PAT with `gist` scope for writing badge data |
| `fail-below` | `0` | Fail the GitHub Actions check if the score drops below this threshold |

### Outputs

| Output | Description |
|---|---|
| `score` | Code quality score (0-100) |
| `score-before` | Score before fixes were applied |
| `issues-found` | Total number of issues found |
| `issues-fixed` | Total number of issues fixed |
| `pr-url` | URL of the created pull request (fix mode only) |

### Strictness Levels

| Level | What it catches | Best for |
|---|---|---|
| `low` | Critical security issues, crash-causing bugs | Quick CI gate |
| `medium` | + type errors, lint violations, dead code | Regular maintenance |
| `high` | + stubs, duplicates, style issues, coverage gaps | Production readiness |

---

## The Sloppy Score

Sloppy produces a single number from **0 to 100** representing your codebase health.

The score is a weighted composite across all eight categories. Security and bugs weigh more than lint and style. A repo with zero critical issues but some lint violations still scores high.

| Score | Color | Meaning |
|---|---|---|
| 90 -- 100 | Bright green | Clean. Ship it. |
| 70 -- 89 | Green | Solid. Minor issues only. |
| 50 -- 69 | Yellow | Needs attention. Meaningful issues present. |
| 30 -- 49 | Orange | Significant problems. Fix before shipping. |
| 0 -- 29 | Red | Critical issues. Do not ship. |

The score is tracked over time in `.sloppy/history.json` inside your repository. Git is the database. You can query it, graph it, or pipe it into anything that reads JSON.

### Using `fail-below` as a CI Gate

```yaml
      - uses: braedonsaunders/sloppy@v1
        with:
          fail-below: '70'
```

If the score drops below 70, the action fails and blocks the PR. Use this to enforce a quality floor.

---

## Badge Setup

Show your Sloppy Score in your README with a dynamic badge.

### Step 1: Create a Gist

Create a public GitHub Gist with a file named `sloppy-badge.json`. The content doesn't matter -- Sloppy will overwrite it.

### Step 2: Create a PAT

Create a personal access token with the `gist` scope. Add it as a repository secret named `GIST_TOKEN`.

### Step 3: Configure the Action

```yaml
      - uses: braedonsaunders/sloppy@v1
        with:
          gist-id: 'your-gist-id-here'
          gist-token: ${{ secrets.GIST_TOKEN }}
```

### Step 4: Add the Badge

```markdown
![Sloppy Score](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/YOUR_USERNAME/YOUR_GIST_ID/raw/sloppy-badge.json)
```

The badge updates automatically on every Sloppy run with the current score and color.

---

## Dashboard

Sloppy writes score history to `.sloppy/history.json` in your repo. To get a visual dashboard:

1. Enable GitHub Pages on your repo (Settings > Pages)
2. Point it at the branch and directory containing `.sloppy/`
3. Sloppy includes a static `index.html` dashboard that reads `history.json` and renders score trends

Zero hosting. Zero config. Just GitHub Pages.

---

## FAQ

**Q: Is the free scan actually free?**

Yes. It uses the GitHub Models free tier, which is available to all GitHub users. No API key needed. The `models: read` permission in the workflow grants access. You can scan unlimited repos at no cost.

**Q: What's the difference between scan mode and fix mode?**

Scan mode analyzes your code and reports a score. Fix mode does everything scan mode does, then uses an AI coding agent (Claude Code or OpenAI Codex) to actually fix the issues and open a pull request. Scan is free. Fix requires an API key.

**Q: Will fix mode break my code?**

Every fix runs through your test suite. If tests fail after a fix, that fix is reverted automatically. Sloppy also commits each fix atomically, so you can `git revert` any individual change. It works on its own branch and opens a PR -- your main branch is never modified directly.

**Q: Why multi-pass? Isn't one scan enough?**

No. Fixing issue A often reveals issue B that was hidden behind it. A function that was dead code becomes reachable after a refactor. A type error surfaces after removing an `any` cast. One pass gives you a partial picture. Sloppy keeps scanning until two consecutive passes find nothing new.

**Q: What happens if a run hits the 6-hour GitHub Actions limit?**

Sloppy checkpoints its progress and triggers a new workflow run to continue. This is called self-chaining. By default it will chain up to 3 times (18 hours total). You can control this with the `max-chains` input.

**Q: How much does fix mode cost?**

It depends on your codebase and the issues found. The `max-cost` input (default: `$5.00`) caps spending per run. A typical medium-sized repo costs $1-3 per fix run. You can also use a Claude Max subscription via OAuth token for flat-rate pricing.

**Q: Where is the data stored?**

In your Git repo. Score history lives in `.sloppy/history.json`. Badge data goes to a GitHub Gist you control. The dashboard is a static page served by GitHub Pages. There is no external database, no third-party server, no telemetry.

**Q: Does the author of Sloppy host anything?**

No. Zero infrastructure. No servers, no databases, no SaaS, no analytics. The action runs entirely on your GitHub Actions runner using your API keys. The author hosts nothing and has no access to your code or data.

**Q: Can I use this with monorepos?**

Yes. Sloppy respects your repository structure and scopes its analysis to the files present. You can configure `fix-types` to focus on specific categories relevant to your project.

**Q: What languages does Sloppy support?**

The free scan tier works with any language supported by GitHub Models. Fix mode supports whatever Claude Code or OpenAI Codex can handle, which covers most mainstream languages. TypeScript-specific checks (type errors, lint) require a TypeScript project.

---

## Contributing

Contributions are welcome. Sloppy is ~2000 lines of TypeScript compiled with `@vercel/ncc` into a single file for the GitHub Action runtime.

```bash
# Clone
git clone https://github.com/braedonsaunders/sloppy.git
cd sloppy

# Install
npm install

# Build
npm run build

# Type check
npm run typecheck
```

The compiled output goes to `dist/index.js`, which is what the action runs.

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

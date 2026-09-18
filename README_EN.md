# agent-design-figma · AI UI Design Skill

[中文版](README.md)

In a nutshell: **Just say "Design a homepage for an AI healthcare App", and it automates the entire process from design brief, to Figma rendering, to quality review and asset export.**

After installation, you only need to tell the AI what you want to design — industry style, color palette, typography, components, and page structure are all automatically inferred by the Skill. The generated results will go through an automated visual critique, and any non-compliant parts will be automatically fixed and re-checked.

## Project Background & Origins

This project is derived from my full-stack open-source experimental project — [JasonOracle/figma-agent-bridge](https://github.com/JasonOracle/figma-agent-bridge) (which aims to explore the full-pipeline automation of AI Agents from design system construction, full-page high-fidelity design, to front-end code generation).

In the original `figma-agent-bridge` project, I successfully built a local bridge that allows AI to directly manipulate a real Figma canvas. To make this powerful "AI Design Brain" more widely reusable, I extracted its core **Automated UI Design Skill**, deeply optimized and encapsulated it, and spun it off into this standalone `agent-design-figma` project.

It focuses on solving a core scenario: **empowering Large Language Models (LLMs) with professional UI design cognition and cross-platform execution capabilities**. You can use it as an independent component, seamlessly integrate it into your own AI assistant or Agent development workflow, and obtain an out-of-the-box automated design pipeline with zero barriers to entry.

## What It Can Do

| You Input | You Get |
|---|---|
| "Design a modern AI health management App homepage" | Design Brief → Design System → **Figma Page (Auto-drawn)** → Visual Quality Critique Report → PNG / SVG / Export Manifest |
| "Design a Henan highway smart maintenance dashboard" | Same as above, automatically applying a dark-themed government dashboard style and industry color palette |
| "Design an enterprise backend Dashboard" | Same as above, automatically applying an enterprise-level backend style |

Supports Chinese industry semantics (healthcare / government / education / enterprise backend, etc.). Color palettes and styles are derived from built-in industry mapping rules, not random, and not templated.

## Actual Generation Showcase

Below is a showcase of real output generated and rendered to Figma by the LLM entirely automatically, after a new user installed the Skill and gave a simple one-sentence instruction.

**Figma Client Real Canvas Rendering Effect:**

<div align="center">
  <img src="./assets/demo-outputs/figma-workspace.png" width="100%" alt="Figma Workspace Screenshot" />
</div>
<br/>

**Generated High-Fidelity Page Details (including Home, Products, About Us, etc.):**

<div align="center">
  <img src="./assets/demo-outputs/home@2x.png" width="48%" alt="Home Page Generation" />
  <img src="./assets/demo-outputs/about@2x.png" width="48%" alt="About Page Generation" />
</div>
<br/>
<div align="center">
  <img src="./assets/demo-outputs/products@2x.png" width="48%" alt="Products Page Generation" />
  <img src="./assets/demo-outputs/story@2x.png" width="48%" alt="Story Page Generation" />
</div>

*Note: The above pages, from product structure planning, copywriting, design system construction, to Figma node rendering, are completed entirely by the Agent automatically with zero manual intervention.*

## Installation (3 Steps)

**1. Clone this repository into your skills directory** (pick the one your tool actually reads; if unsure, put it in both)

```bash
# WorkBuddy —— Windows corresponds to %USERPROFILE%\.workbuddy\skills\
git clone https://github.com/JasonOracle/agent-design-figma.git ~/.workbuddy/skills/agent-design-figma

# CodeBuddy / Some IDE tools read this one —— Windows corresponds to %USERPROFILE%\.codebuddy\skills\
git clone https://github.com/JasonOracle/agent-design-figma.git ~/.codebuddy/skills/agent-design-figma
```

If you are unfamiliar with git, you can also download the ZIP (Repository page → Code → Download ZIP), extract it, and put the entire folder into the corresponding directory. **Keep the folder name as `agent-design-figma`**.

> Always use HTTPS above. The SSH address (`git@github.com:`) requires an SSH key to be configured beforehand, otherwise it will fail directly.

**2. Start the local bridge program in the repository root directory** (zero dependencies, no npm install required)

```bash
node bridge/server.js
```

The terminal will print a line `token: xxxx…`, copy it.

**3. Import the included plugin into Figma and connect**

Figma Desktop → Plugins → Development → Import plugin from manifest… → Select `figma-plugin/manifest.json` in this repository; run the plugin, paste the token into the panel and click Connect, it turns green at the top when successful.

For detailed steps see **[SETUP.md](SETUP.md)**, for a complete usage tutorial see **[USER_GUIDE.md](USER_GUIDE.md)**.

Self-check (≈10 seconds, confirms environment is ready):

```bash
node ~/.workbuddy/skills/agent-design-figma/tools/runtime-check.mjs
```

Expect to see `"mode": "FULL_MODE"`, and both `figmaRead` and `figmaWrite` **are `true`** — read capability doesn't just come from MCP, the Bridge has built-in `get-page-summary` / `get-node` / `export-node`. It can run in any working directory, and the result lands in `.vibe/runtime-capability.json` under the skill directory.

**Write channel self-check** (offline, no Figma required, ≈1 second):

```bash
node ~/.workbuddy/skills/agent-design-figma/tools/qa-plugin.mjs
```

Runs through the four effect types and node read-back semantics using a strict Figma validation stub. It must be all green to prove that `BACKGROUND_BLUR` (the only way to implement frosted glass) is truly usable on the current version of the plugin — this is exactly a P0 incident fixed in this version, now backed by regression tests.

> It can also be used without installing the Figma plugin: The Skill will output the complete design document (brief / design system / build plan), it just won't automatically draw it into Figma.

## Directory Structure

- `SKILL.md` — Agent Execution Manual (L0–L5 Design Pipeline Rules)
- `SETUP.md` — Installation Guide (from a regular user's perspective, 5 minutes)
- `USER_GUIDE.md` — Usage Tutorial (walkthrough of the first complete run)
- `bridge/server.js` — Local bridge program (zero dependencies, the write channel for automatic Figma drawing; includes `POST /v1/batch` batch channel)
- `figma-plugin/` — Figma plugin (for import, includes manifest / code.js / ui.html)
- `references/bridge-ops.md` — **Authoritative list of write channel ops** (36 ops, parameter shapes, batch syntax, error codes, frosted glass recipes)
- `references/design-system.md` — **L2 Contract** (Brief→DS Spec derivation: five types of Tokens / whitelist derivation / component decision matrix / state matrix / 4-platform layout templates)
- `references/acceptance-criteria.md` — **D1 hard acceptance criteria** (determine the runtime tier first; a machine gate for each of "no manual patching / no dead references / no eyeballed scoring"; command table + evidence template + three-way attribution + blind spots stated in the open)
- `references/` — Design intelligence rules (industry mapping / style libraries / visual critique / mapping rules / runtime mode determination)
- `tools/runtime-check.mjs` — Runtime environment self-check probe (L0)
- `tools/qa-plugin.mjs` — Plugin regression test (runs offline, covers four effect types and read-back semantics)
- `tools/qa-bridge.mjs` — Bridge end-to-end test (starts real server + mocks plugin, covers batch channel)
- `tools/qa-l2.mjs` — L2 Output validation (four items: Schema / no unknown colors in Token / coverage and quantity / DS single source of truth); can validate any output (`--spec` + `--brief`)
- `tools/qa-l2-mutation.mjs` — Mutation test for qa-l2 (injects known errors item by item to ensure the validation actually alarms — prevents "fake validations that always PASS")
- `tools/layout-audit.mjs` — L4 Layout audit (**13 checks**: spacing / padding / radius / font-size / alignment / touch / overflow / baseline / overlap / duplicate / text-container-fixed / text-justified / font-family-count, based on get-node measured coordinates). **Scales are derived from the L2 DS Spec** (`--spec <dsspec.json>`, 1.3 A2) — hand-typed scales are the root cause of "the same data yielding different warning counts"; the artifact records where every number came from in `paramSource` / `paramGaps`; `geometryCoverage` records **how many nodes actually ran through the checks** — with `get-node`'s default `depth:1` the children carry no geometry, so those nodes **never run a single check** (measured on one 5-node tree: `{depth:1}` → **1/2**, `{depth:2}` → **2/5**, yet **both report the same "1 shallow container"** while the unchecked nodes are 1 versus 3; container count is a proxy metric, node count is the real scale — reproducible via `tools/layout-audit-readback-probe.mjs`). **New in 1.3 F4 step 3: three checks + one grading**: `text-container-fixed` (text container with `textAutoResize=NONE` — both axes fixed ⇒ growing text can only overflow or be clipped) / `text-justified` (justified alignment) / `font-family-count` (more families than the cap, default 3); overflow is escalated to **high** when the parent has `clipsContent=true` (silent clipping), while `TRUNCATE` text goes into the `textTruncated` list **without raising an issue** (an explicit ellipsis is intentional). All three come from the "unused fields inventory" (see `tools/contract-usage.mjs`)
- `tools/layout-audit-mutation.mjs` — Mutation test for layout-audit (**125 assertions**: catches errors + **does not false-positive** (false-positive control is this tool's main cost) + skip-traceability + reverse control for parameter derivation + **geometry coverage**, including the reverse control "must not report shallow read-back when geometry is complete" + both sides of the three new checks from 1.3 F4 step 3 + **#48 reverse control: feeding `--json` output to a text assertion must throw** (prevents vacuously passing assertions))
- `tools/pixel-proof.mjs` — **L4 pixel-visibility instrument for effect parameters** (adopted in 1.3 C1, zero dependencies): for a single image it prints a histogram (distinct colours / background colour / non-background ratio) + an ASCII density map (showing the **distribution** of content, not just the total); for two images it prints a per-pixel diff. `--expect-diff` / `--expect-same` / `--expect-content` turn the conclusion into an exit code, so it can serve as a gate directly. It addresses `lessons.md` #56 (fill opacity and similar parameters are **structurally unobservable** — `paintToHex` drops `paint.opacity`) / #57 (an effect applied to a flat colour has no observable consequence) / #59 (a successful export does not mean there is content). **Capability boundaries are stated explicitly**: only 8-bit non-interlaced PNG (16-bit/interlaced exits 2); A/B refuses mismatched sizes (no cropping or scaling)
- `tools/pixel-proof-mutation.mjs` — Mutation test for pixel-proof (**46 assertions**: **synthesises PNGs across every colorType and all 5 filter bytes to cross-check decoder correctness** — real screenshots cannot serve as the baseline, that would be circular reasoning)
- `tools/contrast-audit.mjs` — L4 Color-dimension contrast audit: recomputes the WCAG ratio for the "text × surface" matrix from the DS Spec tokens, and compares **every hand-written number** in `accessibility.contrast` against the recomputation (on first run, 9 of the 13 claimed values in the bundled examples did not match)
- `tools/contrast-audit-mutation.mjs` — Mutation test for contrast-audit (36 cases: injects 9 error classes + boundary values / non-white backgrounds / non-hex values, asserting it catches errors without false positives)
- `tools/qa-critic.mjs` — L4 Critic output validation (134 assertions: Schema / five-dimension scores with recomputed `average` / issue evidence must carry a **quantity or a verification action** / targetLayer routing / loop self-consistency / `_evidence` tier contract / cross-artifact agreement); validates any output (`--report` + `--brief` + `--spec`), `--strict` promotes soft findings to failures
- `tools/qa-critic-mutation.mjs` — Mutation test for qa-critic (52 assertions: injects 30+ classes of known defects + reports all at once + `--strict` escalation + zero-warning gate on the bundled examples)
- `tools/qa-export.mjs` — **L5 export gate** (935 assertions, QA1–QA9: a built-in minimal draft-07 validator performs **real Schema validation** of the manifest / exported files exist / node ids are re-readable / mapping is complete / **token `value` snapshots are recomputed + `source` is inherited** / no orphan mappings + Export Gate self-consistency / freeze zone untouched / **identity agreement** / **traceability**). On its first run it found 32 places where an artifact disagreed with the DS Spec it declares, and fixed a conditional branch in the Schema that said "allowed" in prose but not in semantics (`if/then` can only add constraints — relaxations must go in `else`). **1.3 criterion amendment (D2/D4)**: QA3 no longer **requires** `figmaFileKey` for the `live-build` tier — that credential is a precondition for "read back by fileKey+nodeId" under a **REST-API upstream**, whereas this pipeline reads back through a **Bridge-attached plugin** (a single `nodeId` suffices) and no plugin op returns it ⇒ in this topology it is noise: one permanent FAIL, explained away on every wrap-up. The rule is now "if you cannot obtain it, record `null` honestly and explain the gap in `_meta.note`"; silently leaving it blank / whitespace-only / as an empty string is still blocked (a 1-for-1 swap — the count of credential assertions is unchanged)
- `tools/qa-export-mutation.mjs` — Mutation test for qa-export (**63 assertions**: injects 30+ classes of known defects + both directions of the Schema conditional + **both sides of the criterion amendment** (honest `null` must pass; missing note / all-whitespace / empty string must fail; each branch carries exactly one credential assertion and its assertion line is visible) + zero-warning baseline + "must say it could not check" for the freeze zone + the no-`.git` path)
- `tools/qa-install.mjs` — **Install-contract check (L0, 100 assertions)**: runs all three modes end-to-end (real bridge + mock plugin + fake home, checked against the Capability Matrix) · verifies the probe's read-only promise and cwd-independence behaviourally · **recomputes** the user-visible hint strings quoted across the four docs (it does not check "does this keyword appear" — it treats the probe's actual output as the source of truth) · port consistency across five places / `localhost` spelling / `::1` binding / token path and persistence across restarts. On its first run it caught the canonical doc quoting a truncated OFFLINE hint that did not match what the probe actually emits
- `tools/qa-install-mutation.mjs` — Mutation test for qa-install (82 assertions: builds a self-contained fake install package, injects 30 classes of defects + zero-warning baseline + reports everything at once + `--no-behavior`/`--quiet` degradation paths + non-zero soft-rule hits). **It caught three bugs in this tool itself**: crashing with a stack trace on a missing file, `includes(name)` checks being satisfied by comments, and one case that stayed green while never actually testing anything
- `tools/precheck.mjs` — **Pre-flight check before build plan execution** (L3): runs your op sequence offline through the real `code.js`, reports all static errors at once (unknown op / missing required fields / param types / color formats / effect fields silently dropped); `--live` can further cross-check existing ids on the canvas
- `tools/precheck-mutation.mjs` — Mutation test for precheck (75 assertions: injects 13 types of errors + full run of 36 ops + B2 online end-to-end cross-check)
- `tools/figma-harness.mjs` — Shared harness for offline loading of real `code.js` (strict effect stub + effect field bi-directional contract), shared by qa-plugin and precheck
- `tools/check-refs.mjs` — Document reference validation (scans bundled `.md` files, verifies imperative references and backtick paths line by line, exits non-zero if dangling)
- `tools/check-refs-mutation.mjs` — Mutation test for check-refs (creates a sample repo with known errors, asserts it catches errors without false positives)
- `tools/release-guard.mjs` — **Release-consistency guard (B5 / B6, zero dependencies)**: six mechanical judgements — `VERSION` is valid semver · `CHANGELOG` contains the release section for that version · section versions are monotonically non-increasing top to bottom · the top `-dev` section is **greater than** `VERSION` · the `v<VERSION>` tag exists · **the `VERSION` file at the tag's tip matches the working tree** (catches a tag placed on a commit where `VERSION` had not been updated yet). ⚠️ It checks the **ordering relation, not equality**: `VERSION` records "the last versioned (accepted) release" while the top of `CHANGELOG` may be a larger `-dev` section (`CHANGELOG.md` lines 7–11 spell this out; the original premise of candidate B5 — "do not check that the two agree" — **was itself wrong**). When git is unavailable it records "not checked" and says so, and **never treats that as a pass**; under `--strict` unchecked items block too
- `tools/release-guard-mutation.mjs` — Mutation test for release-guard (**39 assertions**: each of the six judgements broken in turn + one broken judgement must not contaminate the others + **reverse control: when `VERSION` and the top `-dev` section differ but the ordering is correct it must stay all green** (this pins down "check order, not equality") + git-less environments honestly reported as unchecked + `--json` is directly pipeable)
- `tools/layout-audit-readback-probe.mjs` — **Cross-module contract probe** (1.3 A1): uses `figma-harness` to load the **byte-for-byte unmodified** `figma-plugin/code.js` (via `vm`, read-only — it never touches the frozen zone), drives the real `execute("get-node")` to produce responses, and feeds them to the real `layout-audit --json`. Four judgements pin down the cross-frozen-zone contract "read-back shape ↔ tool input". It **complements rather than duplicates** `layout-audit-mutation.mjs`: the latter feeds **synthetic trees** to verify "given the right shape, does the tool judge correctly", while this probe feeds **real responses** to verify "is the real shape actually like that"
- `tools/contract-usage.mjs` — **Usage matrix of the read-back contract** (1.3 F4 step 3): parses the serialization block of `code.js` on the spot to get all 33 contract fields, scans property accesses in `tools/*.mjs`, and sorts them into three tiers: used / weakly referenced (bare word) / **zero references (= the "unused fields inventory", the deliverable itself)**. The judge has teeth: every field must either have a consumer or carry a "why not now" reason in `UNUSED_OK` — **any bidirectional inconsistency exits 1** (prevents the inventory from silently rotting). ⚠️ "Used" only reaches L1 (a property access exists), it does not prove the read-back product is consumed — `precheck` reads the plan, `qa-plugin` is self-testing
- `tools/contract-usage-mutation.mjs` — Mutation test for contract-usage (**42 assertions**: each of the three judge criteria broken in turn + **reverse controls** (a deleted field must be caught; `--json` fed to a text assertion must throw) + parse guard (an implausibly small parse result exits 2))
- `tools/anchor-compare.mjs` — **The mechanical device for anchor side-by-side comparison** (1.3 F3 step 2): tokens declared by an anchor brand's DESIGN.md ←→ tokens actually used on the canvas (palette RGB Euclidean distance / font families / type scale), protocol in `references/anchor-compare.md`. Anchor source = `nexu-io/open-design` (151+ brand contracts, Apache-2.0, **external and optional, not vendored**). Judgements J1–J5 are all "did the device run honestly" (provenance quartet / both sides parse non-empty / snapshot sha256 replayable) — **none of them is "does it look alike"**: the similarity verdict belongs to read-image item R11 + a human (H3 zero eyeball scoring)
- `tools/anchor-compare-mutation.mjs` — Mutation test for anchor-compare (**43 assertions**: 8 must-catch groups (missing provenance / empty anchor / token-less canvas) + must-pass + report content + pure-function unit tests (known color distances / the family-parse signature: shadow and breakpoint tables must not leak into families))
- `references/lessons.md` — **88 empirically measured invariants** (protocol / Plugin API / data flow / testing / Windows environment / collaboration; marks which are guarded by tools and which rely purely on discipline)
- `references/design-criteria-intake.md` — **Screening method for absorbing external design criteria (F4)**: a check item from a mature design skill must pass **four screens** (**static? → does the premise hold? → judgeable? → a check or a recipe?**) before it can be absorbed, and the answer is only ever **carry / translate / defer to a human / no object / already covered**, plus **split** (one rule reaching different verdicts internally, so it must be screened again sentence by sentence). Includes a per-item triage of **46 principles across 3 sources** (traced to the primary source): `better-ui` 17 · `better-layout` 10 · `better-typography` 19 — measured: **43% have nowhere to land on a static canvas** and **33% must be split sentence by sentence**. Also carries the **read-back contract table** (exactly which fields `get-node` returns), the "continuous formula meets discrete whitelist" adjudication sample (concentric corner radius), and the first batch of read-image checklist items feeding F3
- `references/read-image-checklist.md` — **Read-image checklist (F3③ · in-package source of truth, 11 items)**: defect patterns only judgeable by reading the image — 4 semantic-missing items from E1 (no axis labels / no units / no empty states / no legend) + 4 read-image cores from screened external criteria (widows & bad wrapping / truncated-value reachability / mixed-script order / reading order) + 3 in-house vision-tier items (icon style / visual focus / **commercial-product similarity — n-a only until the anchor-comparison device lands in F3②**). **Read-image items are not gate items** (H3 zero eyeballing): the output is an observation record with replayable evidence (verdict `ok`/`issue`/`n-a`, one `read-image-review.json` per run directory), not a score; **from F3① a `structured+vision` review must leave per-item traces — having the ability but skipping the reading is a violation**
- `assets/examples/example-health.ops.json` — A real L3 build plan example (42 steps), can be fed directly to `precheck.mjs`
- `assets/style-library/` — Four Style Presets (Enterprise Backend / Gov Dashboard / Brand Website / Modern SaaS)
- `assets/templates/` — JSON Schemas for various deliverables (critic-report / design-system-spec / export-manifest / read-image-review)
- `assets/examples/` — Complete examples for three industries (Enterprise Backend / Healthcare App / Gov Dashboard)

## Execution Modes (Auto-determined, no config needed)

Every time the Skill starts, it uses `tools/runtime-check.mjs` to probe the environment and automatically chooses to run as much as possible:

| Mode | Conditions | Execution Scope |
|---|---|---|
| **FULL_MODE** | Figma plugin connected | Full pipeline: Design → Auto-draw → Critique → Export (Read capability comes bundled with Bridge) |
| **READ_ONLY_MODE** | Bridge not connected, but has Figma read-only MCP | Design doc + Build plan; Prompts "Current environment only has read capability, Figma Bridge must be installed to auto-draw" |
| **OFFLINE_MODE** | Neither | Only generates the design document trio, honestly marks execution as skipped |

No mode will **pretend to execute** — steps not run will explicitly state they were not run.

## Technical Boundaries (Optional Reading)

The Skill is the design brain, it only produces JSON contracts and build plans; the actual reading/writing to Figma is done by the existing channels in your environment (the plugin + local bridge bundled in this repo, or an existing Figma MCP on the market). **This Skill does not develop or replace any MCP.**

---
MIT licensed.

#!/usr/bin/env node
/**
 * release-guard.mjs — 发版一致性守卫（1.3 · B5 + B6）
 *
 *   node tools/release-guard.mjs [--root <dir>] [--strict] [--json]
 *
 * 为什么存在：`qa-install.mjs` 只校「**探针报的 version ↔ `VERSION` 文件**」一致，
 * 而 `VERSION` 与 `CHANGELOG` 的关系、`VERSION` 与 `git tag` 的关系，**此前没有任何守卫**：
 *   · 1.2 定版前 `VERSION` 停在 `1.2.0-dev`、CHANGELOG 却已开到 1.3 段 —— 两处对不上时**全部闸门照绿**；
 *   · 2026-09-17 起本仓库开始打 tag，但「`v$(cat VERSION)` 是否存在、落点对不对」全靠手工记得。
 *
 * ⚠️ **判据不是「两处必须相等」** —— 这是本工具设计上最容易做错的地方，别改回去。
 * `CHANGELOG.md` 第 7–11 行自己写死了这层关系：`VERSION` 记**最后一个已定版（已验收）的版本**，
 * 而 CHANGELOG 顶部**允许**同时存在标着「未发布」的 `-dev` 段 —— 两者语义不同、本就允许不同。
 * （B5 在候选清单里的原始表述是「不校两者一致」，那是个**不成立的前提**；
 *   F4 试点新增的筛子 S1.5「前提是否成立?」正该在动工前拦下它。）
 * 所以这里校的是**序关系**：顶部若有 `-dev` 段，它的版本必须 **>** `VERSION`。
 *
 * 六条检查（每条都能机械判，不含主观判断）：
 *   A  `VERSION` 存在且是合法 semver
 *   B  `CHANGELOG` 存在 `## [<VERSION>]` 定版段（当前版本有对应的发布记录）
 *   C  `CHANGELOG` 版本段**自上而下单调不增**（防新段落被插到底部、无人察觉）
 *   D  顶部段若是 `-dev`，其版本 **>** `VERSION`（B5 的真形态）
 *   E  tag `v<VERSION>` 存在（B6）
 *   F  tag 落点处的 `VERSION` 文件内容 === 当前 `VERSION`（防 tag 打在错误提交上）
 *
 * 「核不了」怎么办（#61 / #72）：E / F 依赖 `git`。取不到时**如实记入 `unchecked`**
 * 并在结论行写明「N 项未核对」，**绝不折算为通过**；默认不阻塞（`WARN`），
 * `--strict` 时未核对也算失败 —— 与 `qa-export` 的档位惯例一致。
 * 本仓库历史事实：`1.0.0` / `1.1.0` **从未打 tag**。本工具只校**当前 `VERSION`**，
 * 故不会把历史欠账报成当下的错；但也因此**它不能证明历史版本打过 tag**。
 *
 * 退出码：0 全绿（或仅未核对且未加 `--strict`）；1 有 FAIL / `--strict` 下有未核对；2 用法错误。零依赖。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const optOf = (n) => {
  const i = args.indexOf(n);
  return i > -1 ? args[i + 1] : null;
};
const STRICT = args.includes("--strict");
const JSON_ONLY = args.includes("--json");
const ROOT = path.resolve(optOf("--root") || path.join(HERE, ".."));

const TAG_PREFIX = "v";

/* ---------------- semver ---------------- */

/** `"1.2.0"` / `"1.3.0-dev"` / `"1.2.0 · D2 运行 A"` → 三元组 + 是否预发布。解析不了返回 null。 */
function parseVer(raw) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(raw).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null, raw: String(raw).trim() };
}
/** 只比三元组大小（预发布后缀不参与）—— 本项目版本语义就到这里，不比 semver 的 pre-release 排序。 */
const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;
const fmt = (v) => `${v.major}.${v.minor}.${v.patch}`;

/* ---------------- 读取 ---------------- */

const checks = [];
const unchecked = [];
const fail = (id, name, detail) => checks.push({ id, name, ok: false, detail });
const pass = (id, name, detail) => checks.push({ id, name, ok: true, detail });

function readFileOrNull(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function git(...cmd) {
  const r = spawnSync("git", cmd, { cwd: ROOT, encoding: "utf8" });
  if (r.error) return { ok: false, why: r.error.code === "ENOENT" ? "环境里没有 git" : String(r.error.message) };
  if (r.status !== 0) return { ok: false, why: (r.stderr || "").trim().split("\n")[0] || `git ${cmd[0]} 退出码 ${r.status}` };
  return { ok: true, out: r.stdout.trim() };
}

/* ---------------- A · VERSION ---------------- */

const versionRaw = readFileOrNull(path.join(ROOT, "VERSION"));
let version = null;
if (versionRaw === null) {
  fail("A", "VERSION 文件存在", `找不到 ${path.join(ROOT, "VERSION")}`);
} else {
  version = parseVer(versionRaw);
  if (!version) fail("A", "VERSION 是合法 semver", `内容为 ${JSON.stringify(versionRaw.trim())}，解析不出 major.minor.patch`);
  else pass("A", "VERSION 是合法 semver", `${version.raw}${version.pre ? `（预发布后缀 ${version.pre}——定版过的版本不该带后缀，请复核）` : ""}`);
}

/* ---------------- B / C / D · CHANGELOG ---------------- */

const clRaw = readFileOrNull(path.join(ROOT, "CHANGELOG.md"));
const sections = [];
if (clRaw === null) {
  fail("B", "CHANGELOG.md 存在", `找不到 ${path.join(ROOT, "CHANGELOG.md")}`);
} else {
  clRaw.split("\n").forEach((line, i) => {
    const m = /^##\s+\[([^\]]+)\]/.exec(line);
    if (!m) return;
    const v = parseVer(m[1]);
    sections.push({ line: i + 1, label: m[1].trim(), ver: v ? fmt(v) : null, isDev: !!(v && v.pre) });
  });
}

if (sections.length && version) {
  // B 存在当前版本的定版段
  const hit = sections.find((s) => s.ver === fmt(version) && !s.isDev);
  if (hit) pass("B", "CHANGELOG 含当前版本的定版段", `[${hit.label}] 在第 ${hit.line} 行`);
  else fail("B", "CHANGELOG 含当前版本的定版段", `VERSION=${fmt(version)}，但 CHANGELOG 里没有 \`## [${fmt(version)}]\` 段`);

  // C 单调不增（同版本的多份子段允许相等）
  const bad = [];
  for (let i = 1; i < sections.length; i++) {
    const prev = parseVer(sections[i - 1].ver || "");
    const cur = parseVer(sections[i].ver || "");
    if (!prev || !cur) continue;
    if (cmp(cur, prev) > 0) bad.push(`${sections[i - 1].label}（第 ${sections[i - 1].line} 行）→ ${sections[i].label}（第 ${sections[i].line} 行）递增了`);
  }
  if (bad.length) fail("C", "CHANGELOG 版本段自上而下单调不增", bad.join("；"));
  else pass("C", "CHANGELOG 版本段自上而下单调不增", `${sections.length} 段`);

  // D 顶部 -dev 段的序关系（B5 的真形态）
  const head = sections[0];
  if (!head.isDev) pass("D", "顶部段与 VERSION 的序关系", `顶部已是定版段 [${head.label}]，无 -dev 段需比`);
  else {
    const hv = parseVer(head.label);
    if (cmp(hv, version) > 0) pass("D", "顶部 -dev 段版本 > VERSION", `${fmt(hv)} > ${fmt(version)}`);
    else fail("D", "顶部 -dev 段版本 > VERSION", `顶部 [${head.label}] 的 ${fmt(hv)} 不大于 VERSION ${fmt(version)} —— 未发布的段不可能小于等于已定版的版本`);
  }

  // 一个额外的事实核对：不止顶部，**任何**段都不该比 VERSION 高得离谱（提前开太多段）
  // —— 这条不做判据，只作为信息行，避免把「计划中的下一个版本」误判成错。
} else if (clRaw !== null && !version) {
  // VERSION 读不出合法版本号时，B/C/D 三条**都无从判起** —— 如实记未核对。
  // 一度写成 fail B「CHANGELOG 里一个段都没解析到」，那是**编了一个错理由**：
  // 出问题的是 VERSION，CHANGELOG 通常好好的。这与 #61 同一条纪律 ——
  // 报 FAIL 时必须说清「是产物错了」还是「是我核不了」，两者处置完全不同。
  for (const [id, name] of [
    ["B", "CHANGELOG 含当前版本的定版段"],
    ["C", "CHANGELOG 版本段自上而下单调不增"],
    ["D", "顶部 -dev 段与 VERSION 的序关系"],
  ]) {
    unchecked.push({ id, name, why: "不核对：VERSION 读不出合法版本号，无从比对" });
  }
} else if (clRaw !== null) {
  fail("B", "CHANGELOG 含当前版本的定版段", "CHANGELOG 里一个 `## [x.y.z]` 段都没解析到");
}

/* ---------------- E / F · git tag ---------------- */

const tagName = versionRaw === null || !version ? null : `${TAG_PREFIX}${fmt(version)}`;

const gitProbe = git("rev-parse", "--is-inside-work-tree");
if (!tagName) {
  unchecked.push({ id: "E", name: `tag ${TAG_PREFIX}<VERSION> 存在`, why: "VERSION 读不出版本号，无从拼 tag 名" });
  unchecked.push({ id: "F", name: "tag 落点处 VERSION 一致", why: "同上" });
} else if (!gitProbe.ok) {
  unchecked.push({ id: "E", name: `tag ${tagName} 存在`, why: `不核对：${gitProbe.why}` });
  unchecked.push({ id: "F", name: "tag 落点处 VERSION 一致", why: `不核对：${gitProbe.why}` });
} else {
  const r = git("rev-list", "-n", "1", tagName);
  if (!r.ok) {
    fail("E", `tag ${tagName} 存在`, `git 说没有这个 tag（${r.why}）—— 发版后须打 tag，否则「发过哪版」只活在 CHANGELOG 里`);
    unchecked.push({ id: "F", name: "tag 落点处 VERSION 一致", why: `不核对：tag ${tagName} 不存在，无落点可查` });
  } else {
    const sha = r.out.split("\n")[0];
    const when = git("log", "-1", "--format=%cI %s", tagName);
    pass("E", `tag ${tagName} 存在`, `${sha.slice(0, 8)}${when.ok ? ` · ${when.out.split("\n")[0]}` : ""}`);

    const atTag = git("show", `${tagName}:VERSION`);
    if (!atTag.ok) {
      unchecked.push({ id: "F", name: "tag 落点处 VERSION 一致", why: `不核对：读不到 ${tagName}:VERSION（${atTag.why}）` });
    } else if (atTag.out.trim() === String(versionRaw).trim()) {
      pass("F", "tag 落点处 VERSION 一致", `${tagName}:VERSION = ${atTag.out.trim()}`);
    } else {
      fail("F", "tag 落点处 VERSION 一致", `${tagName}:VERSION = ${atTag.out.trim()}，而工作区的 VERSION = ${String(versionRaw).trim()} —— tag 打在了 VERSION 还没更新的提交上`);
    }
  }
}

/* ---------------- 输出 ---------------- */

const nFail = checks.filter((c) => !c.ok).length;
const nPass = checks.length - nFail;
const clean = nFail === 0;

if (JSON_ONLY) {
  console.log(
    JSON.stringify(
      {
        tool: "release-guard",
        root: ROOT,
        version: versionRaw === null ? null : versionRaw.trim(),
        tag: tagName,
        changelogSections: sections,
        checks,
        unchecked,
        summary: { pass: nPass, fail: nFail, unchecked: unchecked.length, strict: STRICT },
        _meta: {
          judged: "只校**序关系**，不校「VERSION 与 CHANGELOG 顶部相等」——后者是错误前提（见文件头）",
          history: "1.0.0 / 1.1.0 从未打 tag；本工具只校当前 VERSION",
          baseCheck: "探针 ↔ VERSION 文件的一致性由 qa-install.mjs 负责，本工具不重复",
        },
      },
      null,
      2,
    ),
  );
} else {
  console.log(`\nrelease-guard   仓库 ${ROOT}`);
  console.log(`VERSION ${versionRaw === null ? "（读不到）" : versionRaw.trim()}   CHANGELOG 段 ${sections.length} 个${sections.length ? `（顶部 ${sections[0].label}）` : ""}   tag ${tagName || "（不适用）"}`);
  console.log("");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.id} ${c.name} —— ${c.detail}`);
  for (const u of unchecked) console.log(`  未核对  ${u.id} ${u.name} —— ${u.why}`);
  if (!unchecked.length) console.log("  未核对  无");
  console.log("");
  if (nFail) console.log(`结果：${nPass} PASS / ${nFail} FAIL / ${unchecked.length} 未核对 —— 发版一致性**不成立**`);
  else if (unchecked.length) console.log(`结果：${nPass} PASS / 0 FAIL / ${unchecked.length} 未核对 —— 已查项全绿，但**有 ${unchecked.length} 项没查成**（不是通过）`);
  else console.log(`结果：${nPass} PASS / 0 FAIL / 0 未核对 —— 发版一致性 OK`);
}

if (nFail || (STRICT && unchecked.length)) process.exit(1);

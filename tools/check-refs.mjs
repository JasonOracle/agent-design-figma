#!/usr/bin/env node
/**
 * check-refs.mjs — 文档引用校验器（1.2 · A4）
 *
 * 治「12 处失效引用」的机制性根因：文档承诺了不存在的文件，而这件事原来靠人工勾选
 * （上游 release-checklist.md 把手改引用列为人工项，勾了没做干净）。本工具把它变成机器闸门。
 *
 * 扫什么：仓库内所有「会随包发出去」的 `.md` 文档（`DEV_ONLY` 里列的版本规划/清查文档除外，
 *   它们记录上游与历史，允许引用包外文件）。
 * 找什么：
 *   ① 命令式引用 —— `node tools/qa-l2.mjs` / `python tools/foo.py` 这类脚本执行指令；
 *   ② 反引号文件引用 —— `` `references/bridge-ops.md` `` 这类内联代码里的带扩展名路径。
 * 怎么判：
 *   ① 相对仓库根存在；② 相对该文档所在目录存在；③ glob（`tools/*.mjs`）按模式匹配。
 *   三条都不中、且引用**不含目录**时，才走 ④ 同名兜底（basename）。
 *   **含目录的引用不再兜底**（1.3 · B4 收紧）：目录是引用的一部分，目录对不上就是悬空——
 *   旧行为让「目录写错、文件名对」全数通过（实测 `example-health/critic-report.json`
 *   少写 `assets/examples/` 前缀却一直报绿，正是这一类）。
 *   同名兜底命中**多份**时如实报歧义（WARN，列全部候选），**不静默取遍历顺序的第一个**。
 *   全部不中 → 悬空引用，报警并非零退出。
 *
 * 特例（产物类型名，**算已解析**而不是豁免）：
 *   `assets/templates/` 下放的是各产物的 Schema 定义。文档写 `` `critic-report.json` ``（不带目录）
 *   时说的是「**这种产物**」，而仓库里同时存在定义（templates）与若干实例（examples）。
 *   判据机械可判且免维护：**该名字在 `assets/templates/` 下有同名文件** ⇒ 判为产物类型名，
 *   落点一律定为那份定义（`how=artifact`）。旧行为会静默指向第一个实例（实测 17 条全指向
 *   `assets/examples/example-health/…`），给出一个「具体文件」的假象。
 *
 * 豁免（每类都说明理由，不是「见了就跳」）：
 *   · RUNTIME_PATTERNS —— 运行时产物（`.vibe/` 下的探针输出等）。它们**本来就只在跑完之后才存在**，
 *     文档引用它们是描述「产出在哪」，不是承诺「仓库里有」。
 *   · DOTPATH_ROOTS —— DS Spec / Brief 的点路径（如 `tokens.radius.md` 是 radius 下的 md 档，
 *     不是 markdown 文件）。判据收紧到「无 `/` + 至少 3 段 + 首段是已知对象根」，
 *     所以真文件 `manifest.json`（2 段）不会被误豁免。
 *   · 角度占位符 —— `<skill 根目录>/tools/runtime-check.mjs`、`<readback.json>` 里的尖括号段先剥掉，
 *     占位符不是文件；剥完以 `/` 开头的路径按仓库根锚定。
 *   · 后缀式提及 —— 以 `.` 开头、不含 `/`、且全仓库找不到同名的 token（如 「不是 `.dsspec.json`」）
 *     是**扩展名/后缀模式**的写法，不是文件名。真 dotfile（`.gitignore` 之类）存在时会走
 *     basename 命中，所以这条只对"查不到的"生效——**代价是漏掉 dotfile 的拼写错误**，这个取舍是有意的：
 *     一个在正常散文上反复误报的校验器，用户会直接关掉它，那比漏报更糟。
 *   · DEPLOY_PATHS —— 部署后路径（`node ~/.workbuddy/skills/<技能>/tools/x.mjs`）。它说的是
 *     「装完之后在用户机器的哪儿跑」，不是「本仓库里有这个文件」——仓库里没有 `~` 这一层。
 *     旧行为靠 basename 兜底会「看起来命中仓库同名文件」，但那是巧合，不是它的意思，
 *     故单列豁免、不计入已解析（免得汇总里把「巧合命中」说成「引用落地」）。
 *   · PLACEHOLDER_ROOTS —— 斜杠式占位符根：`/skill/bridge/server.js` 的 `/skill` 是「技能根目录」
 *     的简写（同 `<skill 根目录>/…`，只是没写尖括号）。尖括号形式已被 stripPlaceholders 剥掉，
 *     斜杠写法只能在此识别。判据收紧到「**首段是已知占位符名**」，不是「以 `/` 开头就放过」。
 *
 * 写文档的约定（否则会被本工具如实抓出）：
 *   要举例时用**占位符**（`node <skill>/tools/xxx.mjs`、`<readback.json>`）或改用叙述，
 *   不要写一个假路径充数——本工具不区分「举例」与「真引用」，这正是它想抓的东西。
 *   Token 用反引号（`` `tokens.radius.md` ``）没问题，点路径豁免认它；真文件名（`manifest.json`）不会被豁免。
 *
 * 用法：
 *   node tools/check-refs.mjs              # 校验本仓库（0 悬空才算过）
 *   node tools/check-refs.mjs --root <dir> # 校验另一个根（如安装副本）
 *   node tools/check-refs.mjs --quiet      # 只出汇总
 *   node tools/check-refs.mjs --list       # 额外列出每条「已解析」引用（排错用）
 *
 * 零依赖（仅 node 内置模块）；根目录默认由 import.meta.url 自定位，任意 cwd 可跑。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const optOf = (name) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : null;
};
const QUIET = argv.includes("--quiet");
const LIST = argv.includes("--list");

const rootArg = optOf("--root");
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`根目录不存在：${ROOT}`);
  process.exit(2);
}

/** 遍历时跳过的目录：非交付内容 / 体积大 / 运行时生成 */
const SKIP_DIRS = new Set([".git", "node_modules", ".vibe", "release", ".workbuddy", "dist", "build", ".cache"]);

/** 视为「文件引用」的扩展名 */
const FILE_EXT = new Set([
  "md", "json", "mjs", "js", "cjs", "py", "html", "htm", "svg", "png", "jpg", "jpeg",
  "webp", "css", "txt", "yml", "yaml", "sh", "ps1", "ts", "vue", "zip",
]);

/**
 * 开发者内部文档（不随技能发布给用户，允许引用包外路径）。
 * 仓库根的 `<版本号>-*.md` 是 1.2 起的规划 / 清查类文档，性质等同于上游被发布包
 * 明确排除的 release-checklist.md。
 */
const DEV_ONLY = [/^\d+\.\d+-[^/]*\.md$/];

/** 运行时产物：跑完才有，文档引用它属于描述产出位置，不构成「仓库里该有」的承诺 */
const RUNTIME_PATTERNS = [/^\.vibe\//, /(^|\/)runtime-capability\.json$/];

/** 点路径的对象根（DS Spec / Brief 的结构名，绝不会是目录名） */
const DOTPATH_ROOTS = new Set(["tokens", "spec", "brief", "buildPlan", "plan", "node", "report", "op"]);

/** 部署后路径：`~/…` 描述的是用户机器上的安装位置，不是本仓库内的文件（见头部说明） */
const DEPLOY_PATHS = [/^~\//];

/** 斜杠式占位符根：`/skill/…` 的 `/skill` 是「技能根目录」的简写（见头部说明） */
const PLACEHOLDER_ROOTS = new Set(["skill"]);

/**
 * 产物类型名：`assets/templates/` 下的文件名。
 * 判据 = 「文档引用的裸名在 templates 下有同名定义」⇒ 它在说「这种产物」，不是「某个实例」。
 * 机械可判、免维护（templates 增删自动生效），且落点确定（那份定义），不是猜的。
 */
const TEMPLATE_DIR = "assets/templates";
const artifactNames = new Set();
const tplAbs = path.join(ROOT, TEMPLATE_DIR);
if (fs.existsSync(tplAbs) && fs.statSync(tplAbs).isDirectory()) {
  for (const e of fs.readdirSync(tplAbs, { withFileTypes: true })) {
    if (e.isFile()) artifactNames.add(e.name);
  }
}

/* ---------------- 建立文件索引 ---------------- */

/** @type {string[]} 根目录内全部文件（posix 相对路径） */
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name));
    } else if (e.isFile()) {
      files.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join("/"));
    }
  }
})(ROOT);

const fileSet = new Set(files);
/** basename → 命中路径（同名多份时如实记录，供诊断） */
const baseMap = new Map();
for (const f of files) {
  const b = path.posix.basename(f);
  if (!baseMap.has(b)) baseMap.set(b, []);
  baseMap.get(b).push(f);
}

/* ---------------- 提取与判定 ---------------- */

const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
const globToRe = (g) => new RegExp("^" + g.split("*").map(esc).join("[^/]*") + "$");

/** ① 命令式：node / python / npx / bash 后紧跟的脚本路径 */
const CMD_RE = /\b(?:node|python3?|npx|bash|sh)\s+([^\s`'"<>|;&()]+\.(?:mjs|js|cjs|py|sh|ps1))/g;
/**
 * ② 整个反引号 token 就是一个带扩展名的路径。
 * 首字符类含 `.`，否则 `.vibe/runtime-capability.json` 这类**点目录开头**的路径会被整条漏掉
 * （正则连不上 → 既不报错也不进豁免，等于 RUNTIME_PATTERNS 空转）。
 * 可带 `./` `../` `/` 前缀，可含 `*` 通配。
 */
const TICK_PATH_RE = /^(?:\.{0,2}\/)?[A-Za-z0-9_@.][A-Za-z0-9_@./*-]*\.[A-Za-z0-9]+$/;

const isRuntime = (t) => RUNTIME_PATTERNS.some((re) => re.test(t));
/** 点路径：无 `/`、至少 3 段、首段是已知对象根（`tokens.radius.md` 命中，`manifest.json` 不命中） */
const isDotPath = (t) => {
  if (t.includes("/")) return false;
  const seg = t.split(".");
  return seg.length >= 3 && DOTPATH_ROOTS.has(seg[0]);
};
/** 后缀式提及：以 `.` 开头、无 `/`（如 `.dsspec.json` 这种"扩展名"写法）。真 dotfile 会走 basename 命中。 */
const isSuffixMention = (t) => !t.includes("/") && t.startsWith(".");

/** 部署后路径（`~/…`）：说的是「装完之后在哪儿跑」，不是仓库里有这个文件 */
const isDeployPath = (t) => DEPLOY_PATHS.some((re) => re.test(t));

/** 斜杠式占位符根（`/skill/…`）：首段须是已知占位符名，且后面还有段（`/skill` 光杆不豁免） */
const isPlaceholderRoot = (t) => {
  if (!t.startsWith("/")) return false;
  const seg = t.slice(1).split("/");
  return seg.length > 1 && PLACEHOLDER_ROOTS.has(seg[0]);
};

/** 产物类型名：无目录，且 `assets/templates/` 下有同名定义（见头部说明） */
const isArtifactName = (t) => !t.includes("/") && artifactNames.has(t);

/** 剥掉角度占位符段：`<skill 根目录>/tools/x.mjs` → `/tools/x.mjs` */
const stripPlaceholders = (line) => line.replace(/<[^<>\n]{0,48}>/g, "");

/**
 * 判定一条引用是否落地。
 * @returns {{ok:boolean, how:string, hit?:string, others?:string[]}}
 */
function resolveRef(ref, docRel) {
  const raw = ref.replace(/^\.\//, "");
  const docDir = path.posix.dirname(docRel);
  const cands = [];
  const hasDir = raw.includes("/");

  if (raw.startsWith("/")) {
    cands.push(raw.slice(1)); // 以 `/` 开头 = 仓库根锚定
  } else if (hasDir) {
    cands.push(raw); // 相对仓库根
    cands.push(path.posix.normalize(path.posix.join(docDir, raw))); // 相对该文档
  } else {
    cands.push(path.posix.normalize(path.posix.join(docDir, raw))); // 同目录同名
  }

  for (const c of cands) {
    if (c.includes("*")) {
      const re = globToRe(c);
      const hit = files.find((f) => re.test(f));
      if (hit) return { ok: true, how: "glob", hit };
    } else if (fileSet.has(c)) {
      return { ok: true, how: "path", hit: c };
    }
  }

  // 引用里写了目录 = 指定了位置。目录对不上就是悬空，**不再靠同名兜底**（1.3 · B4）。
  // 旧行为下「目录写错、文件名对」全数通过：`example-health/critic-report.json`
  // 少写 `assets/examples/` 前缀却报绿，正是这一类。
  if (hasDir) return { ok: false, how: "dangling" };

  const hits = baseMap.get(path.posix.basename(raw));
  if (!hits || !hits.length) return { ok: false, how: "dangling" };
  if (hits.length === 1) return { ok: true, how: "basename", hit: hits[0] };
  // 同名多份：存在性成立，但「指哪一份」判不出来 ⇒ 如实报歧义，不静默取第一个。
  return { ok: true, how: "ambiguous", hit: hits[0], others: hits.slice(1) };
}

/* ---------------- 扫描 ---------------- */

const scanned = [];
const skippedDocs = [];
const dangling = [];
const resolved = [];
const ambiguous = [];
let exemptRuntime = 0;
let exemptDotpath = 0;
let exemptSuffix = 0;
let exemptDeploy = 0;
let exemptPlaceholder = 0;
let refCount = 0;

for (const doc of files.filter((f) => f.endsWith(".md")).sort()) {
  if (DEV_ONLY.some((re) => re.test(doc))) {
    skippedDocs.push(doc);
    continue;
  }
  scanned.push(doc);
  const lines = fs.readFileSync(path.join(ROOT, doc), "utf8").split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const line = stripPlaceholders(rawLine);
    const found = new Map(); // ref → 首次出现行号（同行去重）

    for (const m of line.matchAll(CMD_RE)) found.set(m[1], i + 1);
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const tok = m[1].trim().replace(/[),;:。、]+$/, "");
      if (!TICK_PATH_RE.test(tok)) continue;
      if (!FILE_EXT.has(tok.slice(tok.lastIndexOf(".") + 1))) continue;
      if (!found.has(tok)) found.set(tok, i + 1);
    }

    for (const [ref, ln] of found) {
      if (isRuntime(ref)) {
        exemptRuntime++;
        continue;
      }
      if (isDotPath(ref)) {
        exemptDotpath++;
        continue;
      }
      if (isDeployPath(ref)) {
        exemptDeploy++;
        continue;
      }
      if (isPlaceholderRoot(ref)) {
        exemptPlaceholder++;
        continue;
      }
      if (isSuffixMention(ref) && !fileSet.has(ref) && !baseMap.has(path.posix.basename(ref))) {
        exemptSuffix++;
        continue;
      }
      // 产物类型名：落点是 templates 下那份定义（确定性的，不是兜底猜的），故计入已解析
      if (isArtifactName(ref)) {
        refCount++;
        resolved.push({ doc, line: ln, ref, how: "artifact", hit: `${TEMPLATE_DIR}/${ref}` });
        continue;
      }
      refCount++;
      const r = resolveRef(ref, doc);
      if (r.ok) {
        resolved.push({ doc, line: ln, ref, how: r.how, hit: r.hit });
        if (r.how === "ambiguous") ambiguous.push({ doc, line: ln, ref, hit: r.hit, others: r.others });
      } else dangling.push({ doc, line: ln, ref });
    }
  });
}

/* ---------------- 输出 ---------------- */

const bar = "=".repeat(62);
console.log(bar);
console.log(`check-refs —— 文档引用校验（1.2 A4）｜ root=${ROOT}`);
console.log(bar);

if (LIST && !QUIET) {
  for (const r of resolved) console.log(`  ok    ${r.doc}:${r.line}  ${r.ref}  [${r.how}] → ${r.hit}`);
}
if (resolved.length) {
  const byHow = resolved.reduce((a, r) => ((a[r.how] = (a[r.how] || 0) + 1), a), {});
  console.log(`  已解析 ${resolved.length}：` + Object.entries(byHow).map(([k, v]) => `${k}=${v}`).join(" / "));
}
for (const a of ambiguous) {
  console.log(`  WARN  ${a.doc}:${a.line}  ${a.ref} —— 同名 ${a.others.length + 1} 份，命中 ${a.hit}，另有 ${a.others.join(" / ")}`);
}
for (const d of dangling) console.log(`  FAIL  ${d.doc}:${d.line}  →  ${d.ref}`);

console.log(bar);
console.log(`  扫描文档 ${scanned.length} 篇（跳过开发者内部文档 ${skippedDocs.length} 篇：${skippedDocs.join("、") || "无"}）`);
console.log(
  `  引用总数 ${refCount} ｜ 已解析 ${resolved.length} ｜ 歧义 ${ambiguous.length} ｜ 悬空 ${dangling.length}`,
);
console.log(
  `  豁免 运行时=${exemptRuntime} 点路径=${exemptDotpath} 后缀=${exemptSuffix} 部署路径=${exemptDeploy} 占位符根=${exemptPlaceholder}`,
);

if (ambiguous.length) {
  console.log(
    `\n注意：${ambiguous.length} 条引用靠同名兜底命中，但**同名多份**，「指哪一份」判不出来（WARN，不改退出码）。`,
  );
  console.log(`      修法：写成完整路径 —— 产物类型写 \`${TEMPLATE_DIR}/<名字>\`，具体实例写它自己的位置。`);
}
if (dangling.length) {
  console.log(`\n结果：${dangling.length} FAIL —— 文档引用了不存在的文件，必须修掉或补豁免理由`);
  process.exit(1);
}
console.log(
  "\n结果：0 FAIL —— 文档引用全部落地" +
    (ambiguous.length
      ? `（DOC REFS ALL GREEN，另有 ${ambiguous.length} 条指代歧义需人工定路径）`
      : "（DOC REFS ALL GREEN）"),
);

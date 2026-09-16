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
 *   ① 相对仓库根存在；② 相对该文档所在目录存在；③ 全仓库存在同名文件（basename 兜底，
 *   与上游 stage11-release-package.py 的判定一致）；④ glob（`tools/*.mjs`）按模式匹配。
 *   四条都不中 → 悬空引用，报警并非零退出。
 *
 * 三类豁免（每类都说明理由，不是「见了就跳」）：
 *   · RUNTIME_PATTERNS —— 运行时产物（`.vibe/` 下的探针输出等）。它们**本来就只在跑完之后才存在**，
 *     文档引用它们是描述「产出在哪」，不是承诺「仓库里有」。
 *   · DOTPATH_ROOTS —— DS Spec / Brief 的点路径（如 `tokens.radius.md` 是 radius 下的 md 档，
 *     不是 markdown 文件）。判据收紧到「无 `/` + 至少 3 段 + 首段是已知对象根」，
 *     所以真文件 `manifest.json`（2 段）不会被误豁免。
 *   · 角度占位符 —— `<skill 根目录>/tools/runtime-check.mjs`、`<readback.json>` 里的尖括号段先剥掉，
 *     占位符不是文件；剥完以 `/` 开头的路径按仓库根锚定。
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

/** 剥掉角度占位符段：`<skill 根目录>/tools/x.mjs` → `/tools/x.mjs` */
const stripPlaceholders = (line) => line.replace(/<[^<>\n]{0,48}>/g, "");

/**
 * 判定一条引用是否落地。
 * @returns {{ok:boolean, how:string, hit?:string}}
 */
function resolveRef(ref, docRel) {
  const raw = ref.replace(/^\.\//, "");
  const docDir = path.posix.dirname(docRel);
  const cands = [];

  if (raw.startsWith("/")) {
    cands.push(raw.slice(1)); // 以 `/` 开头 = 仓库根锚定
  } else if (raw.includes("/")) {
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

  const hits = baseMap.get(path.posix.basename(raw));
  if (hits && hits.length) return { ok: true, how: "basename", hit: hits[0] };

  return { ok: false, how: "dangling" };
}

/* ---------------- 扫描 ---------------- */

const scanned = [];
const skippedDocs = [];
const dangling = [];
const resolved = [];
let exemptRuntime = 0;
let exemptDotpath = 0;
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
      refCount++;
      const r = resolveRef(ref, doc);
      if (r.ok) resolved.push({ doc, line: ln, ref, how: r.how, hit: r.hit });
      else dangling.push({ doc, line: ln, ref });
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
for (const d of dangling) console.log(`  FAIL  ${d.doc}:${d.line}  →  ${d.ref}`);

console.log(bar);
console.log(`  扫描文档 ${scanned.length} 篇（跳过开发者内部文档 ${skippedDocs.length} 篇：${skippedDocs.join("、") || "无"}）`);
console.log(`  引用总数 ${refCount} ｜ 已解析 ${resolved.length} ｜ 豁免 运行时=${exemptRuntime} 点路径=${exemptDotpath} ｜ 悬空 ${dangling.length}`);

if (dangling.length) {
  console.log(`\n结果：${dangling.length} FAIL —— 文档引用了不存在的文件，必须修掉或补豁免理由`);
  process.exit(1);
}
console.log("\n结果：0 FAIL —— 文档引用全部落地（DOC REFS ALL GREEN）");

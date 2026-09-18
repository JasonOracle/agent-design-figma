#!/usr/bin/env node
/**
 * qa-export.mjs — L5 Export 出口闸门校验（export-manifest.json + 导出物文件树）
 *
 * 九组检查：
 *   QA1  Manifest Schema  —— 用内置的最小 draft-07 校验器**真校验**三份清单（上游只查了
 *                            required 与一个枚举，Schema 里 40 余条约束无人执行）；
 *                            另附 Schema 自检：拿一份合成 design-phase 实例验证条件分支真的放宽了
 *                            exports.png（描述里写「允许为空」而语义上做不到，是同一类欠债）
 *   QA2  导出物存在        —— existsCheck!=false 的路径逐一落盘；design-phase 规划路径必须带 _meta 说明
 *   QA3  Figma node id     —— id 格式 + live-build 交叉引用（exports ⊆ rootNodeIds）；
 *                            design-phase 必须诚实标 figmaFileKey=null；live-build **不再强制持有**
 *                            figmaFileKey（1.3 · D2/D4 判据修正 —— 本管线回读走 Bridge 直连插件、
 *                            凭 nodeId 单键即可，且插件无任何 op 返回它），但取不到时**必须**在
 *                            `_meta.note` 交代缺口：裁剪的是「持有要求」，不是「诚实要求」。
 *   QA4  Component Mapping —— A/B 类须有 frontendComponent + props，C 类须有 manualNote；layoutRules ≥3
 *   QA5  Token Mapping     ★ —— 五类齐备 + dsToken 沿点路径回溯 dsspec + cssVariable 命名规则
 *                            + **value 快照必须与 DS Spec 原值一致**（value 是导出给前端的最终值，
 *                            写错的后果是前端拿到错色号；此前只有人写、没人算）
 *                            + **source 必须继承 DS Spec 叶子的 source**（可追溯性契约）
 *   QA6  无孤儿映射        —— mapping.dsName ↔ dsspec 组件双向覆盖 + Export Gate 自洽
 *                            （criticScore<8 只允许 design-phase；audit.criticScore == criticReport.average）
 *   QA7  冻结零修改        —— 禁区（figma-plugin//bridge/）git 工作树干净；**核不了必须说核不了**
 *   QA8  身份一致          ★ —— manifest.project == source.brief.product.name == source.dsSpec.brand.name
 *                            （Schema 明文「与 Brief.product.name / brand.name 一致」）；
 *                            随包副本（exports.designSpec.*）与追溯源必须是同一个项目
 *   QA9  可追溯性          ★ —— `preset:<id>.<path>` 的 path 必须能在 assets/style-library/<id>.json 解析到；
 *                            `derived:` 必须给出 `@` 指向的源 token。前缀合法不等于路径真实存在
 *
 * ★ = 1.2 · C3 新增；QA1–QA7 移植自上游 tools/stage10-7-qa.py（237 行），逻辑等价，路径适配本仓库。
 *
 * 硬 / 软两档：check() 进退出码；soft() 只出 WARN。软规则同样要有变异测试断言「命中数非零」，
 * 否则无法区分「没有问题」与「规则从未生效」（references/lessons.md #33）。
 *
 * 关于 $ref 兄弟键：draft-07 规定 `$ref` 的兄弟键被忽略，但 ajv 等实现会一并生效。
 * 本工具选择「一并生效」，同时已把 Schema 改成 allOf 写法，不依赖这个歧义。
 *
 * 用法：
 *   node tools/qa-export.mjs                                  # 校验仓库自带的 export/ 清单
 *   node tools/qa-export.mjs --examples <dir>                 # 校验某目录下形如 example-*-export.json 的清单
 *   node tools/qa-export.mjs --manifest <m.json>              # 校验单份清单
 *   node tools/qa-export.mjs --manifest <缺的路径> --if-absent not-run --reason "<为何没清单>" [--out <record.json>]
 *                             # A4 诚实降级：清单不存在时产出机器可读 NOT_RUN 记录、**退出码 3**
 *                             # （0=查过绿 / 1=查过红 / 2=用法错 / 3=没查 —— 四态互斥，「没查」不许长得像任何一态）
 *   --freeze <p1,p2>   覆盖冻结禁区（默认 figma-plugin,bridge；用户项目按需指定）
 *   --quiet / --strict（WARN 计为失败 —— 仓库自带样例用这一档）
 *
 * 零依赖（仅 node 内置模块）；路径由 import.meta.url 自定位，任意 cwd 可跑。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = path.join(ROOT, "assets", "templates", "export-manifest.json");
const EX_DIR = path.join(ROOT, "assets", "examples", "export");
const STYLE_LIB = path.join(ROOT, "assets", "style-library");

const QUIET = process.argv.includes("--quiet");
const STRICT = process.argv.includes("--strict");
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};

const DEFAULT_FREEZE = ["figma-plugin", "bridge"];
const FREEZE = (arg("--freeze") || DEFAULT_FREEZE.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const NODE_ID_RE = /^\d+:\d+$/;
const CSS_VAR_RE = /^--ds-[a-z0-9-]+$/;
const TOKEN_PATH_RE = /^tokens\.[a-zA-Z0-9.]+$/;
const SOURCE_PREFIX_RE = /^(preset|brief|rule|derived|existing-ds):/;
const CLASSES = ["A-direct", "B-composite", "C-manual"];
const CATS = ["color", "typography", "spacing", "radius", "shadow"];
const STATUSES = ["live-build", "design-phase"];

const pass = [];
const fail = [];
const warn = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);
const bad = (msg) => fail.push(msg);
const soft = (cond, msg) => {
  if (!cond) warn.push(msg);
};
const none = (a) => (a && a.length ? a.join(" / ") : "无");

/* ================= 内置最小 JSON Schema 校验器（draft-07 子集） =================
 * 只覆盖本仓库 Schema 实际用到的关键字；遇到不认识的键不报错（不是完整实现）。
 * 目的不是取代 ajv，而是让「Schema 写了约束」变成「跑一次就执行约束」——零依赖红线下的最优解。 */

const jtype = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
};
const typeOk = (want, v) =>
  (Array.isArray(want) ? want : [want]).some((t) =>
    t === "number" ? typeof v === "number" : t === "integer" ? Number.isInteger(v) : jtype(v) === t
  );

function schemaErrors(inst, schema, root, at = "", out = []) {
  if (!schema || typeof schema !== "object") return out;
  const push = (kw, msg) => out.push({ at: at || "/", kw, msg });

  let sc = schema;
  if (sc.$ref) {
    const tgt = sc.$ref.replace(/^#\//, "").split("/").reduce((o, k) => (o ? o[k] : null), root);
    if (!tgt) push("$ref", `无法解析 ${sc.$ref}`);
    else schemaErrors(inst, tgt, root, at, out);
    // draft-07 说兄弟键应被忽略；本工具一并生效（见文件头说明）
    sc = Object.fromEntries(Object.entries(sc).filter(([k]) => k !== "$ref"));
  }

  if (sc.if) {
    const sub = schemaErrors(inst, sc.if, root, at, []);
    const branch = sub.length ? sc.else : sc.then;
    if (branch) schemaErrors(inst, branch, root, at, out);
  }
  for (const s of sc.allOf || []) schemaErrors(inst, s, root, at, out);

  if (sc.const !== undefined && inst !== sc.const) push("const", `应为常量 ${JSON.stringify(sc.const)}，实际 ${JSON.stringify(inst)}`);
  if (sc.enum && !sc.enum.includes(inst)) push("enum", `取值 ${JSON.stringify(inst)} 不在 ${JSON.stringify(sc.enum)}`);
  if (sc.type && !typeOk(sc.type, inst)) {
    push("type", `类型应为 ${JSON.stringify(sc.type)}，实际 ${jtype(inst)}`);
    return out;
  }
  if (typeof inst === "string") {
    if (sc.pattern && !new RegExp(sc.pattern).test(inst)) push("pattern", `「${inst}」不匹配 ${sc.pattern}`);
    if (sc.minLength !== undefined && inst.length < sc.minLength) push("minLength", `长度 ${inst.length} < ${sc.minLength}`);
  }
  if (typeof inst === "number") {
    if (sc.minimum !== undefined && inst < sc.minimum) push("minimum", `${inst} < ${sc.minimum}`);
    if (sc.maximum !== undefined && inst > sc.maximum) push("maximum", `${inst} > ${sc.maximum}`);
  }
  if (Array.isArray(inst)) {
    if (sc.minItems !== undefined && inst.length < sc.minItems) push("minItems", `${inst.length} 项 < ${sc.minItems}`);
    if (sc.items) inst.forEach((v, i) => schemaErrors(v, sc.items, root, `${at}/${i}`, out));
  }
  if (inst && typeof inst === "object" && !Array.isArray(inst)) {
    for (const k of sc.required || []) if (!(k in inst)) push("required", `缺必填字段 ${k}`);
    for (const [k, sub] of Object.entries(sc.properties || {})) if (k in inst) schemaErrors(inst[k], sub, root, `${at}/${k}`, out);
  }
  return out;
}

/* ================= 取数助手 ================= */

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const relExists = (p) => typeof p === "string" && p !== "" && fs.existsSync(path.resolve(ROOT, p));

/** 沿点路径取值，支持 [n] 数组下标；取不到返回 undefined */
function resolvePath(obj, dotted) {
  let cur = obj;
  for (const seg of String(dotted).split(".")) {
    if (!seg) return undefined;
    const m = /^([A-Za-z0-9_]+)((?:\s*\[\d+\])*)$/.exec(seg);
    if (!m) return undefined;
    cur = cur?.[m[1]];
    for (const i of m[2].matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(i[1])];
    }
    if (cur === undefined || cur === null) return undefined;
  }
  return cur;
}

/** DS Spec 的 token 叶子 → 导出时刻应有的 value 快照 */
function expectValue(leaf) {
  if (!leaf || typeof leaf !== "object") return undefined;
  if ("value" in leaf) return leaf.value;
  if ("size" in leaf && "lineHeight" in leaf)
    return "weight" in leaf ? `${leaf.size}/${leaf.lineHeight}/${leaf.weight}` : `${leaf.size}/${leaf.lineHeight}`;
  return undefined; // 既无 value 也无字阶的复合叶子：无法比对，不判过也不判错
}

/** tokens. 后路径 → kebab CSS 变量（export-mapping.md §5） */
const kebab = (dsToken) =>
  "--ds-" +
  dsToken
    .slice("tokens.".length)
    .split(".")
    .map((s) => s.replace(/(?<=[a-z0-9])(?=[A-Z])/g, "-").toLowerCase())
    .join("-");

/**
 * 剥掉 source 里的「注记」只留直系来源：去括注（全角/半角）与 `+` 串联的后续来源。
 * 例：`preset:premium-saas.visualSystem.typography(26-32)+rule:TY-2` → `preset:premium-saas.visualSystem.typography`
 * 注记是合法的（可在 source 里补自己的说明），所以判据是「前缀」而不是「完全相等」。
 */
const normSource = (s) => String(s).split(/[(（]/)[0].split("+")[0].trim().replace(/\.$/, "");

/** `preset:<id>.<path>` → 落到预设文件上解析；返回 {ok, why, id, p} */
function resolvePresetSource(src) {
  const tail = src.slice("preset:".length);
  const cut = tail.search(/[A-Za-z0-9_]+\./);
  const i = cut === -1 ? -1 : tail.indexOf(".", cut);
  if (i === -1) return { ok: false, why: "缺少 <预设 id>.<字段路径> 结构" };
  const id = tail.slice(0, i);
  const p = tail
    .slice(i + 1)
    .split(/[(（]/)[0] // 去括注（全角/半角）
    .split("+")[0] // 去 `+rule:XX` 之类的串联
    .trim()
    .replace(/\.$/, "");
  const file = path.join(STYLE_LIB, `${id}.json`);
  if (!fs.existsSync(file)) return { ok: false, why: `预设 assets/style-library/${id}.json 不存在`, id, p };
  const preset = readJson(file);
  return resolvePath(preset, p) === undefined
    ? { ok: false, why: `预设 ${id} 里没有 ${p}`, id, p }
    : { ok: true, id, p };
}

/* ================= 目标装载 ================= */

const one = arg("--manifest");
const dir = arg("--examples");

/* ---------------- A4：无清单时的诚实降级（1.3 · A4） ---------------- */

/**
 * 「没查」要有专门的输出形态（#72 / B3 同族）：清单不存在时，旧路径只有两条——
 * 要么整条闸门静默不跑（「查了且干净」与「没查」不可区分），要么 exit 1 的
 * 「清单解析失败」（读起来像产物被查出问题，其实是**没有产物可查**——归因方向是错的）。
 * `--if-absent not-run` 给出第三条路：产出机器可读的 NOT_RUN 记录、退出码 3，
 * 记录里**必须带人写的 reason**（为什么没清单）与 UNVERIFIED 裁决（未核对不得折算为通过）。
 * 「有清单但缺环境凭证」的形态已由 D4 解决（figmaFileKey=null + _meta.note 如实交代）——
 * 两种降级形态至此都有诚实出口。
 */
const ifAbsent = arg("--if-absent");
const absentReason = arg("--absent-reason");
if (one && ifAbsent && !fs.existsSync(path.resolve(process.cwd(), one))) {
  if (ifAbsent !== "not-run") {
    console.error(`--if-absent 仅支持 "not-run"（实际 ${JSON.stringify(ifAbsent)}）`);
    process.exit(2);
  }
  if (!absentReason || absentReason.trim() === "") {
    console.error("A4 降级要求 --absent-reason 非空 —— 「为什么没清单」必须由人交代，不许静默");
    process.exit(2);
  }
  const record = {
    status: "NOT_RUN",
    gate: "qa-export (L5 Export Gate)",
    manifest: path.resolve(process.cwd(), one),
    manifestExists: false,
    reason: absentReason.trim(),
    decision: "UNVERIFIED —— 未核对，不得折算为通过；补齐 export-manifest.json 后必须复跑本闸门",
    emittedBy: "tools/qa-export.mjs --if-absent not-run (1.3 · A4)",
    note: "「有清单但缺环境凭证」的另一降级形态见 QA3：figmaFileKey=null + _meta.note 如实交代（D2/D4 判据修正）",
  };
  const outPath = arg("--out");
  const json = JSON.stringify(record, null, 2) + "\n";
  if (outPath) fs.writeFileSync(path.resolve(process.cwd(), outPath), json);
  else process.stdout.write(json);
  console.error(`\n结果：NOT_RUN —— L5 未执行（清单不存在：${one}）`);
  console.error(`  原因：${record.reason}`);
  console.error(`  裁决：${record.decision}`);
  if (outPath) console.error(`  记录：${outPath}`);
  process.exit(3);
}

let files;
if (one) files = [path.resolve(process.cwd(), one)];
else {
  const d = dir ? path.resolve(process.cwd(), dir) : EX_DIR;
  if (!fs.existsSync(d)) {
    console.log(`目录不存在：${d}`);
    process.exit(2);
  }
  // 正向形状：只认 example-<名>-export.json，不为「排除已知的坏东西」而写反向规则（lessons #36）
  files = fs
    .readdirSync(d)
    .filter((f) => /^example-[^.]+\.json$/.test(f))
    .map((f) => path.join(d, f))
    .sort();
}
if (!files.length) {
  console.log("没有找到任何 export-manifest");
  process.exit(2);
}

const targets = [];
for (const f of files) {
  const name = path.basename(f).replace(/\.json$/, "");
  try {
    targets.push({ name, file: f, m: readJson(f) });
  } catch (e) {
    bad(`QA1 ${name} 清单解析失败：${e.message}`);
  }
}
const specOf = (m) => (relExists(m?.source?.dsSpec) ? readJson(path.resolve(ROOT, m.source.dsSpec)) : null);
const briefOf = (m) => (relExists(m?.source?.brief) ? readJson(path.resolve(ROOT, m.source.brief)) : null);
const statusOf = (m) => m?._meta?.status ?? "live-build"; // 缺席按最严档：live-build

/* ================= QA1 Manifest Schema ================= */

let schema = null;
try {
  schema = readJson(SCHEMA_PATH);
  check(true, `QA1 Schema 可解析：${path.basename(SCHEMA_PATH)}`);
} catch (e) {
  bad(`QA1 Schema 解析失败：${e.message}`);
}
if (schema) {
  const need = ["project", "version", "source", "exports", "mapping", "tokens", "audit"];
  const miss = need.filter((k) => !(schema.required || []).includes(k));
  check(!miss.length, `QA1 Schema 顶层 required 齐备（缺 ${none(miss)}）`);
  const fsEnum = schema.properties?.audit?.properties?.freezeStatus?.enum;
  check(
    JSON.stringify(fsEnum) === JSON.stringify(["passed", "failed", "pending"]),
    `QA1 Schema audit.freezeStatus 枚举 = passed|failed|pending（实际 ${JSON.stringify(fsEnum)}）`
  );

  // Schema 自检：条件分支必须**真的**放宽 design-phase 的 exports.png。
  // JSON Schema 的 allOf/if-then 只能叠加约束——若把 minItems:1 写在基座、再在 then 里写 minItems:0，
  // 净效果仍是 minItems:1，「描述允许、语义不允许」的谎就埋下了。
  const synth = {
    project: "X",
    version: "0",
    source: { brief: "b.json", dsSpec: "s.json", figmaFileKey: null, rootNodeIds: [] },
    exports: {
      png: [],
      svg: [],
      figmaJson: { path: null, note: "规划" },
      designSpec: { brief: "b.json", dsSpec: "s.json" },
    },
    mapping: { components: [{ figmaComponent: "F", dsName: "D", class: "C-manual", manualNote: "x" }] },
    tokens: Object.fromEntries(
      Object.entries({ color: 8, typography: 5, spacing: 1, radius: 1, shadow: 1 }).map(([c, n]) => [
        c,
        Array.from({ length: n }, (_, i) => ({ dsToken: `tokens.${c}.t${i}`, cssVariable: `--ds-${c}-t${i}`, source: "rule:x" })),
      ])
    ),
    audit: { qaPassed: false, criticScore: 7, freezeStatus: "pending" },
    _meta: { status: "design-phase", note: "规划" },
  };
  const e1 = schemaErrors(synth, schema, schema);
  check(e1.length === 0, `QA1 Schema 条件分支真的放宽了 design-phase 的空 exports.png（报错 ${e1.length} 条${e1.length ? "：" + e1.map((e) => `${e.at} ${e.msg}`).join("；") : ""}）`);
  const e2 = schemaErrors({ ...synth, _meta: { status: "live-build" } }, schema, schema);
  check(
    e2.some((e) => e.kw === "minItems" && e.at === "/exports/png"),
    "QA1 Schema 反向自检：live-build 时空 exports.png 必须被拦（否则条件分支方向写反了）"
  );
}

for (const { name, m } of targets) {
  const errs = schemaErrors(m, schema, schema);
  check(errs.length === 0, `QA1 ${name} 通过 Schema 校验（${errs.length} 处违例${errs.length ? "：" + errs.map((e) => `${e.at} ${e.kw}:${e.msg}`).join("；") : ""}）`);
  check(typeof m.project === "string" && m.project.trim() !== "", `QA1 ${name} project 非空`);
  check(typeof m.version === "string" && m.version.trim() !== "", `QA1 ${name} version 非空`);
  check(m.source?.brief && m.source?.dsSpec, `QA1 ${name} source.brief / source.dsSpec 路径非空`);
  const cs = m.audit?.criticScore;
  check(typeof cs === "number" && cs >= 0 && cs <= 10, `QA1 ${name} audit.criticScore=${cs} ∈ 0-10`);
  check(STATUSES.includes(statusOf(m)), `QA1 ${name} _meta.status=${JSON.stringify(m._meta?.status)} 合法或缺省按 live-build`);
}

/* ================= QA2 导出物存在 ================= */

for (const { name, m } of targets) {
  for (const kind of ["png", "svg"]) {
    for (const [i, e] of (m.exports?.[kind] || []).entries()) {
      const p = e?.path;
      check(typeof p === "string" && p.trim() !== "", `QA2 ${name} exports.${kind}[${i}] path 非空`);
      if (e?.existsCheck === false) check(!!m._meta, `QA2 ${name} exports.${kind}[${i}] 为规划路径（existsCheck=false），必须有 _meta 说明`);
      else check(relExists(p), `QA2 ${name} exports.${kind}[${i}] 文件存在：${p}`);
    }
  }
  const fj = m.exports?.figmaJson || {};
  if (fj.path) check(relExists(fj.path), `QA2 ${name} exports.figmaJson 文件存在：${fj.path}`);
  else check(!!fj.note, `QA2 ${name} exports.figmaJson.path 为空必须带 note 说明`);
  for (const k of ["brief", "dsSpec"]) {
    const p = m.exports?.designSpec?.[k];
    check(typeof p === "string" && p.trim() !== "", `QA2 ${name} designSpec.${k} 路径非空`);
    if (p) check(relExists(p), `QA2 ${name} designSpec.${k} 文件存在：${p}`);
  }
  const cr = m.exports?.designSpec?.criticReport;
  if (cr) check(relExists(cr), `QA2 ${name} designSpec.criticReport 文件存在：${cr}`);
}

/* ================= QA3 Figma node id 可回读 ================= */

for (const { name, m } of targets) {
  const roots = m.source?.rootNodeIds || [];
  const badIds = roots.filter((r) => !NODE_ID_RE.test(r));
  check(!badIds.length, `QA3 ${name} rootNodeIds 全match ^\\d+:\\d+$（违例 ${none(badIds)}）`);
  const exported = ["png", "svg"].flatMap((k) => m.exports?.[k] || []).map((e) => e.nodeId);
  const badExported = exported.filter((n) => !NODE_ID_RE.test(n || ""));
  check(!badExported.length, `QA3 ${name} 导出 nodeId 全match ^\\d+:\\d+$（违例 ${none(badExported)}）`);

  if (statusOf(m) === "live-build") {
    /**
     * ⚠️ 1.3 判据修正（D2 / D4，2026-09-17）—— 此处原为
     *     `check(!!m.source?.figmaFileKey, "live-build 必须有 figmaFileKey")`，现**裁剪**。
     *
     * 裁剪的理由不是「太严」，而是**代理指标换了拓扑就失效**：fileKey 的用途是「按 fileKey+nodeId
     * 回读」，那在**基于 REST API 的上游**里是必要条件；而本管线的回读通道是 **Bridge 直连插件**，
     * `get-node` 凭 `nodeId` 单键即可，且插件**没有任何 op 返回 `figma.fileKey`**（冻结区缺口，
     * 运行 A / 运行 B 两次独立确认）⇒ 在本拓扑下它不是判据，是噪音：本环境永远 1 条 FAIL，
     * 且每次收口都得额外解释「FAIL 的是环境凭证、不是产物质量」。
     *
     * 裁剪**不等于放宽**：拿不到就**必须在 `_meta.note` 里交代**（与 design-phase 分支同形状）。
     * 「静默留空」照旧拦下 —— 变的是「要求持有凭证」，不变的是「要求说明缺口」。
     * 它的**盲区**（如实记在 `acceptance-criteria.md` §1.3）：note 非空**不证明画布真的存在**，
     * 只证明执行者显式交代了缺口；画布是否存在由 `precheck --live` 的实际回读证明。
     */
    check(roots.length > 0, `QA3 ${name} live-build 必须有 rootNodeIds`);
    const outside = exported.filter((n) => !roots.includes(n));
    check(!outside.length, `QA3 ${name} 全部导出 nodeId ∈ rootNodeIds（可按 nodeId 回读；越界 ${none(outside)}）`);
    // ⚠️ 分支条件必须是 `fk == null`（只认 null / 缺字段），**不能**写成 `!fk` ——
    // 后者会把空串也归进「如实标 null」，于是 `figmaFileKey: ""` 只要求补一句 note 就过关了。
    const fk = m.source?.figmaFileKey ?? null;
    if (fk == null) {
      check(
        !!(m._meta?.note && String(m._meta.note).trim()),
        `QA3 ${name} live-build 且 figmaFileKey=null ⇒ 必须在 _meta.note 说明缺口（本管线无 op 返回 fileKey；不许静默留空）`,
      );
    } else {
      // 反方向也不许漏：`""` 既不是「持有凭证」也不是「如实标 null」，它是「静默留空」的另一种写法
      // （旧判据用 `!!` 恰好把空串拦下了，裁剪时若只写 `?? null` 就会把它放过）。
      check(
        String(m.source.figmaFileKey).trim().length > 0,
        `QA3 ${name} live-build 的 figmaFileKey 已声明就必须非空（取不到请写 null 并在 _meta.note 说明缺口；空串=静默留空）`,
      );
    }
  } else {
    check(m.source?.figmaFileKey == null, `QA3 ${name} design-phase 必须诚实标 figmaFileKey=null`);
    check(!!m._meta?.note, `QA3 ${name} design-phase 必须在 _meta.note 说明`);
  }
}

/* ================= QA4 Component Mapping 完整 ================= */

for (const { name, m } of targets) {
  const comps = m.mapping?.components || [];
  check(comps.length >= 1, `QA4 ${name} mapping.components 非空（${comps.length} 条）`);
  for (const [i, c] of comps.entries()) {
    check(CLASSES.includes(c?.class), `QA4 ${name} comp[${i}] class=${JSON.stringify(c?.class)} 合法`);
    check(typeof c?.figmaComponent === "string" && c.figmaComponent.trim() !== "", `QA4 ${name} comp[${i}] figmaComponent 非空`);
    check(typeof c?.dsName === "string" && c.dsName.trim() !== "", `QA4 ${name} comp[${i}] dsName 非空`);
    if (c?.class === "C-manual") {
      check(typeof c.manualNote === "string" && c.manualNote.trim() !== "", `QA4 ${name} comp[${i}](${c.dsName}) C 类 manualNote 必填`);
    } else {
      check(typeof c?.frontendComponent === "string" && c.frontendComponent.trim() !== "", `QA4 ${name} comp[${i}](${c?.dsName}) A/B 类 frontendComponent 非空`);
      check(Array.isArray(c?.props) && c.props.length > 0, `QA4 ${name} comp[${i}](${c?.dsName}) A/B 类 props 非空（映射可执行）`);
    }
  }
  check((m.mapping?.layoutRules || []).length >= 3, `QA4 ${name} layoutRules ≥3 条（Layout → Implementation Rules 随包交付）`);
}

/* ================= QA5 Token Mapping 完整（含 value 快照与 source 继承） ================= */

for (const { name, m } of targets) {
  const toks = m.tokens || {};
  const miss = CATS.filter((c) => !(c in toks));
  check(!miss.length, `QA5 ${name} token 五类齐备（缺 ${none(miss)}）`);
  check((toks.color || []).length >= 8, `QA5 ${name} color 映射 ≥8 条（实际 ${(toks.color || []).length}）`);
  check((toks.typography || []).length >= 5, `QA5 ${name} typography 映射 ≥5 条（实际 ${(toks.typography || []).length}）`);

  const spec = specOf(m);
  let valueChecked = 0;
  let sourceChecked = 0;

  for (const c of CATS) {
    for (const e of toks[c] || []) {
      const tag = `${name} ${e?.dsToken}`;
      check(TOKEN_PATH_RE.test(e?.dsToken || ""), `QA5 ${tag} dsToken 路径格式合法`);
      check(CSS_VAR_RE.test(e?.cssVariable || ""), `QA5 ${tag} cssVariable=${e?.cssVariable} 命名规则合法`);
      check(e?.cssVariable === kebab(e?.dsToken || ""), `QA5 ${tag} cssVariable 与命名规则一致（应为 ${kebab(e?.dsToken || "")}）`);
      check(SOURCE_PREFIX_RE.test(e?.source || ""), `QA5 ${tag} source 带 preset/brief/rule/derived/existing-ds 前缀（可追溯）`);

      if (!spec) continue;
      const leaf = resolvePath(spec, e?.dsToken || "");
      check(leaf !== undefined, `QA5 ${tag} 在 dsspec 中可回溯`);
      if (leaf === undefined || typeof leaf !== "object") continue;
      check("source" in leaf, `QA5 ${tag} dsspec 叶子带 source（可追溯链完整）`);
      if ("source" in leaf) {
        sourceChecked++;
        const man = normSource(e.source);
        const src = normSource(leaf.source);
        check(
          src.startsWith(man),
          `QA5 ${tag} source 继承自 dsspec（清单「${man}」不是 dsspec「${src}」的前缀 —— 指向了别的来源）`
        );
      }

      // value 快照：导出给前端的最终值，必须与事实源一致
      const want = expectValue(leaf);
      if (want === undefined) {
        soft(false, `QA5 ${tag} dsspec 叶子既无 value 也无字阶，value 快照无法比对（不判过也不判错）`);
      } else if (e.value !== undefined) {
        valueChecked++;
        check(String(e.value) === String(want), `QA5 ${tag} value 快照与 dsspec 一致（清单 ${JSON.stringify(e.value)} / 应为 ${JSON.stringify(want)}）`);
      }
    }
  }
  check(valueChecked > 0, `QA5 ${name} 至少核对到 1 条 value 快照（核对 ${valueChecked} 条）`);
  check(sourceChecked > 0, `QA5 ${name} 至少核对到 1 条 source 继承（核对 ${sourceChecked} 条）`);
}

/* ================= QA6 无孤儿映射 + Export Gate 自洽 ================= */

for (const { name, m } of targets) {
  const spec = specOf(m);
  if (!spec) {
    soft(false, `QA6 ${name} 未提供可读的 dsspec，孤儿映射未校验`);
    continue;
  }
  const specNames = new Set((spec.components || []).filter((c) => c?.decision !== "reject").map((c) => c.name));
  const mapNames = (m.mapping?.components || []).map((c) => c.dsName);
  const uncovered = [...specNames].filter((n) => !mapNames.includes(n));
  check(!uncovered.length, `QA6 ${name} dsspec 组件全部被映射（未覆盖 ${none(uncovered)}）`);
  const orphans = mapNames.filter((n) => !specNames.has(n));
  check(!orphans.length, `QA6 ${name} 无孤儿映射（不在 dsspec 中 ${none(orphans)}）`);
  check(mapNames.length === new Set(mapNames).size, `QA6 ${name} dsName 无重复（同名多决策已按名归并）`);

  const cs = m.audit?.criticScore ?? 0;
  if (cs < 8) check(statusOf(m) === "design-phase", `QA6 ${name} criticScore=${cs}<8 → 必须 design-phase（Export Gate：PASS 后才可正式导出）`);
  const cr = m.exports?.designSpec?.criticReport;
  if (cr && relExists(cr) && cr.endsWith(".json")) {
    const avg = readJson(path.resolve(ROOT, cr)).average;
    check(Math.abs(avg - cs) < 1e-9, `QA6 ${name} audit.criticScore=${cs} 与 Critic Report average=${avg} 一致`);
  }

  // audit.qaPassed 是自由文本声称：Export Gate 要求 L3 QA「0 FAIL」，能解析就核对（软档）
  const qa = m.audit?.qaPassed;
  if (typeof qa === "string") {
    for (const h of qa.matchAll(/(\d+)\s*FAIL/gi)) soft(Number(h[1]) === 0, `QA6 ${name} audit.qaPassed 声称「${h[0]}」，与 Export Gate「0 FAIL」矛盾`);
  }
}

/* ================= QA7 冻结文件零修改 ================= */

{
  const label = FREEZE.join(" / ");
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", ...FREEZE], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const dirty = out.split(/\r?\n/).filter((l) => l.trim());
    check(!dirty.length, `QA7 冻结禁区零修改（${label} 工作树干净；脏文件 ${none(dirty)}）`);
  } catch (e) {
    // 核不了就必须说核不了——不许把「没查」写成「干净」（precheck --live 的同一条教训）
    bad(`QA7 冻结态无法核对（git 不可用 / 非 git 仓库 / 禁区路径不存在）：${String(e.message).split("\n")[0]} —— 不得当作通过`);
  }
}

/* ================= QA8 身份一致（跨产物） ================= */

for (const { name, m } of targets) {
  const brief = briefOf(m);
  const spec = specOf(m);
  if (brief) {
    const pn = brief.product?.name;
    check(typeof pn === "string" && pn !== "" && m.project === pn, `QA8 ${name} project「${m.project}」== brief.product.name「${pn ?? "缺失"}」`);
  } else soft(false, `QA8 ${name} source.brief 不可读，project ↔ product.name 未校验`);
  if (spec) {
    const bn = spec.brand?.name;
    check(typeof bn === "string" && bn !== "" && m.project === bn, `QA8 ${name} project「${m.project}」== dsspec.brand.name「${bn ?? "缺失"}」`);
  } else soft(false, `QA8 ${name} source.dsSpec 不可读，project ↔ brand.name 未校验`);

  // 随包副本（exports.designSpec.*）与追溯源（source.*）必须是同一个项目
  for (const [k, srcKey, idKey] of [
    ["brief", "brief", "product"],
    ["dsSpec", "dsSpec", "brand"],
  ]) {
    const copy = m.exports?.designSpec?.[k];
    if (!copy || !relExists(copy)) continue;
    if (copy === m.source?.[srcKey]) continue;
    const copyId = readJson(path.resolve(ROOT, copy))[idKey]?.name;
    check(copyId === m.project, `QA8 ${name} 随包副本 designSpec.${k}「${copyId ?? "缺失"}」与 project「${m.project}」同项目`);
  }
}

/* ================= QA9 可追溯性（source 指向的预设字段真实存在） ================= */

let presetChecked = 0;
for (const { name, m } of targets) {
  for (const c of CATS) {
    for (const e of m.tokens?.[c] || []) {
      const s = e?.source;
      if (typeof s !== "string") continue;
      if (s.startsWith("preset:")) {
        presetChecked++;
        const r = resolvePresetSource(s);
        check(r.ok, `QA9 ${name} ${e.dsToken} 的 preset 源可解析：${s}${r.ok ? "" : ` → ${r.why}`}`);
      } else if (s.startsWith("derived:")) {
        const at = s.slice("derived:".length).match(/@(tokens\.[A-Za-z0-9.]+)/);
        check(!!at, `QA9 ${name} ${e.dsToken} derived 源必须给出 @<源 token> 指向（实际 ${s}）`);
        if (at) {
          const spec = specOf(m);
          check(!spec || resolvePath(spec, at[1]) !== undefined, `QA9 ${name} ${e.dsToken} derived 的源 ${at[1]} 在 dsspec 中存在`);
        }
      }
    }
  }
}
check(presetChecked > 0, `QA9 至少核对到 1 条 preset 源路径（核对 ${presetChecked} 条）`);

/* ================= 汇总 ================= */

/* ================= 评估覆盖留痕（1.3 · B3） ================= */

/**
 * 「这份清单里有多少条**真的被回溯校验过**」必须可见。`source.dsSpec` 读不到时，
 * QA5 的「token 在 dsspec 中可回溯」与 QA9 的 preset 源路径核对会**逐条 continue 跳过**，
 * 汇总里只看得到 PASS 数变少（#72：没查 ≠ 查了没问题）。QA6 已就此报 WARN，这里补上总数与影响面。
 */
const coverageRows = [];
coverageRows.push(`出口清单 ${targets.length} 份：${targets.map((t) => t.name).join("、") || "无"}`);
const noDsSpec = targets.filter((t) => !specOf(t.m)).map((t) => t.name);
if (noDsSpec.length) {
  coverageRows.push(
    `⚠ source.dsSpec 不可读 ${noDsSpec.length}/${targets.length} → QA5「token 可回溯」与 QA9「preset 源路径」对其未执行：${noDsSpec.join("、")}`,
  );
}

const bar = "=".repeat(62);
console.log(bar);
for (const l of coverageRows) console.log(`  评估覆盖  ${l}`);
if (!QUIET) for (const m of pass) console.log(`  PASS  ${m}`);
if (!QUIET) for (const m of warn) console.log(`  WARN  ${m}`);
console.log(bar);
if (fail.length || (STRICT && warn.length)) {
  for (const m of fail) console.log(`  FAIL  ${m}`);
  if (STRICT) for (const m of warn) console.log(`  FAIL  ${m}（--strict：软检查计为失败）`);
  console.log(
    `\n结果：${pass.length} PASS / ${fail.length} FAIL / ${warn.length} WARN${STRICT && warn.length ? "（--strict：WARN 计为失败）" : ""} —— L5 Export Gate 未通过`
  );
  process.exit(1);
}
console.log(`\n结果：${pass.length} PASS / 0 FAIL / ${warn.length} WARN —— L5 Export Gate ALL GREEN`);

#!/usr/bin/env node
/**
 * precheck.mjs — 构建计划开工前预检（1.2 · B1 离线 / B2 在线核对）
 *
 * 存在理由：1.1 那次真实构建里，「参数形状错」是在画到第 N 个 op 时才炸的——Figma 对
 * 效果对象严格校验，多一个 key 就整条赋值被拒。等发现时画布上已经躺了半张页面。
 * 本工具把这类失败**提前到开工之前**。
 *
 * 输入 = **你正要发出去的那串 op**（不是 DS Spec 的 `buildPlan`——那个字段只有
 * `{seq, target, estOps}` 批次视图，没有 op 序列，详见 README/本文件 §「输入形状」）。
 *
 * 契约的事实源 = `figma-plugin/code.js` **自己**。本工具用 vm 离线跑真源码
 * （装置见 `tools/figma-harness.mjs`），而不是再抄一份 op 形状表：
 * 抄一份就会多一处将来必然腐坏的副本，而真正的校验逻辑（必填参数、颜色格式、
 * 效果字段白名单、父级可否容纳子节点）本来就写在 code.js 里。
 *
 * 三档判定，**边界如实打印**：
 *   ① 结构错误 —— 离线可判定，必定为真（op 名越界 / 嵌套 run / params 形状 / 引用未声明）
 *   ② 契约错误 —— 离线试跑 code.js 得到的、带 code 的失败（BAD_PARAM / UNSUPPORTED_OP /
 *      NO_AUTO_LAYOUT_PARENT …）。这是真错误，不是猜的。
 *   ③ 装置缺口 —— 试跑中不带 code 的报错（典型是桩没覆盖到某个宿主 API）。
 *      **不算产品缺陷**，单独列出，提示补桩；当成错误会导致误报，当成通过会掩盖盲区。
 *   ⚠️ 离线**查不出**「画布上那个 node id 到底存不存在」——画布是桩的。这类字面 id 一律
 *      汇总成「待核对外部引用」，交给 `--live`（B2）。这也是为什么本工具不假装能做仿真：
 *      Figma 无事务，仿真做不到；能做的是**核对**。
 *
 * 用法：
 *   node tools/precheck.mjs <plan.json>              # B1 离线预检
 *   node tools/precheck.mjs <plan.json> --live       # 额外连 Bridge 核对外部 id（B2）
 *   …--live 可选：--port <n>（默认 45677） --token <t>（默认读 .vibe/token） --url <base>
 *   …通用：--quiet
 *
 * 退出码：0 = 无错误（可含装置缺口 / 待核对项）｜1 = 有结构或契约错误｜2 = 用法/输入错误
 * 零依赖（仅 node 内置模块 + Node 18+ 自带 fetch）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlugin, EFFECT_INPUT_KEYS, ROOT } from "./figma-harness.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const optOf = (n, d = null) => {
  const i = argv.indexOf(n);
  return i > -1 ? argv[i + 1] : d;
};
const QUIET = flag("--quiet");
const LIVE = flag("--live");
const file = argv.find((a) => !a.startsWith("--") && a !== optOf("--port") && a !== optOf("--token") && a !== optOf("--url"));

const die = (msg, code = 2) => {
  console.error(msg);
  process.exit(code);
};
if (!file) die("用法：node tools/precheck.mjs <plan.json> [--live] [--port <n>] [--token <t>] [--quiet]");

/* ---------------- 输入形状 ---------------- */

/**
 * 接受三种等价形状（都是"一串 op"）：
 *   [{op,params,as}, …]                     裸数组
 *   {steps:[{op,params}, …]}                POST /v1/batch 的请求体
 *   {ops:[{op,params,as}, …]}               插件 run 的载荷
 */
function normalize(obj) {
  if (Array.isArray(obj)) return { steps: obj, shape: "裸数组" };
  if (obj && Array.isArray(obj.steps)) return { steps: obj.steps, shape: "{steps:[…]}（/v1/batch 请求体）" };
  if (obj && Array.isArray(obj.ops)) return { steps: obj.ops, shape: "{ops:[…]}（插件 run 载荷）" };
  return null;
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  die(`读不了计划文件：${file}\n  ${e.message}`);
}

// 常见误用：把 DS Spec 当计划喂进来。它的 buildPlan 只有批次视图，没有 op 序列。
if (raw && !Array.isArray(raw.steps) && !Array.isArray(raw.ops) && raw.buildPlan) {
  die(
    [
      `这不是 op 序列，而是一份 DS Spec：${file}`,
      "",
      "  DS Spec 的 buildPlan 只有 {seq, target, estOps} 的批次视图（Schema 原文：",
      "  「真正的批次规模以 L3 运行期 readback 为准，本字段仅作交接参考」），**不含 op 序列**。",
      "",
      "  本工具的输入应当是**你正要发出去的那串 op**，例如：",
      '    { "steps": [ { "op": "create-frame", "params": { "name": "首页", "width": 1440, "height": 900 } }, … ] }',
      "",
      "  要校验 DS Spec 本身（含 estOps ≤ 30），用：node tools/qa-l2.mjs --spec <DS Spec> --brief <Brief>",
    ].join("\n"),
  );
}

const norm = normalize(raw);
if (!norm) {
  die(
    `认不出计划的形状：${file}\n` +
      "  接受 [{op,params,as}…] / {steps:[…]} / {ops:[…]}（见 tools/precheck.mjs 头部说明）",
  );
}
const { steps, shape } = norm;

/* ---------------- 离线：结构检查 + 逐步试跑 ---------------- */

const h = loadPlugin({ autoVivify: true });
const OP_SET = new Set(h.opNames);
const ID_KEYS = h.idKeys || [];

const errors = [];   // 结构与契约错误（必定为真）
const gaps = [];     // 装置缺口（桩没覆盖到，不是产品缺陷）
const externals = []; // 待核对的外部引用：{step, op, param, id}
const okSteps = [];

const named = new Map();       // as 声明名 → 本地 id
const localIds = new Set();    // 本次试跑创建的 id
let lastCreatedId = null;

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const at = `step ${i}`;
  let broken = false;

  if (!step || typeof step !== "object" || Array.isArray(step)) {
    errors.push({ at, op: null, msg: "步骤不是对象" });
    continue;
  }
  const op = step.op;
  if (typeof op !== "string" || !op) {
    errors.push({ at, op: null, msg: "缺 `op`（必须是非空字符串）" });
    broken = true;
  } else if (op === "run") {
    errors.push({ at, op, msg: "不要嵌套 `run` —— /v1/batch 本身已是批量，传扁平 steps" });
    broken = true;
  } else if (!OP_SET.has(op)) {
    const near = [...OP_SET].filter((n) => n.startsWith(op.slice(0, 4))).slice(0, 4);
    errors.push({
      at,
      op,
      msg: `未知 op「${op}」（合法 ${OP_SET.size} 个；${near.length ? `相近：${near.join(", ")}` : "无相近项"}）`,
    });
    broken = true;
  }
  if (step.params !== undefined && (typeof step.params !== "object" || step.params === null || Array.isArray(step.params))) {
    errors.push({ at, op, msg: "`params` 必须是对象" });
    broken = true;
  }
  if (step.as !== undefined && typeof step.as !== "string") {
    errors.push({ at, op, msg: "`as` 必须是字符串（用于让后续步骤用 $name 指向本步创建物）" });
    broken = true;
  }
  if (broken) continue;

  /* set-effects 的输入字段属于"静默丢弃"型错误：试跑查不出来（既不报错也不生效），
     只能静态拦。1.1 的 P0 就长这样——计划以为给毛玻璃设了颜色，实际只得到一块普通模糊。 */
  if (op === "set-effects" && Array.isArray((step.params || {}).effects)) {
    step.params.effects.forEach((e, j) => {
      const t = e && e.type;
      if (!t) {
        errors.push({ at, op, msg: `effects[${j}] 缺 type` });
        return;
      }
      const allowed = EFFECT_INPUT_KEYS[t];
      if (!allowed) {
        errors.push({
          at,
          op,
          msg: `effects[${j}].type 未知：「${t}」（合法：${Object.keys(EFFECT_INPUT_KEYS).join(" / ")}）`,
        });
        return;
      }
      const extra = Object.keys(e).filter((k) => !allowed.includes(k));
      if (extra.length) {
        errors.push({
          at,
          op,
          msg:
            `effects[${j}]（${t}）多写了 ${extra.map((k) => `"${k}"`).join(", ")} —— ` +
            `set-effects 会**静默丢弃**这些字段（不报错、也不生效），画面会比预期朴素而不自知`,
        });
      }
    });
  }

  /* 引用解析：语义与 code.js 的 `run` 一致 */
  const params = Object.assign({}, step.params || {});
  let refBroken = false;
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (v !== "@last" && !(typeof v === "string" && v.startsWith("$"))) continue;
    if (!ID_KEYS.includes(key)) {
      errors.push({
        at,
        op,
        msg: `"${v}" 只能出现在节点引用字段（${ID_KEYS.join(", ")}），不能给 "${key}"`,
      });
      refBroken = true;
      break;
    }
    if (v === "@last") {
      if (!lastCreatedId) {
        errors.push({ at, op, msg: `"${key}":"@last" 但前面没有任何步骤创建过节点` });
        refBroken = true;
        break;
      }
      params[key] = lastCreatedId;
    } else {
      const n = v.slice(1);
      if (!named.has(n)) {
        errors.push({ at, op, msg: `未知引用 "${v}"：没有更早的步骤用 as:"${n}" 声明过` });
        refBroken = true;
        break;
      }
      params[key] = named.get(n);
    }
  }
  if (refBroken) continue;

  /* 字面 id = 本来就该在画布上的节点（本地创建物一律走 $name/@last，不可能提前知道 id） */
  for (const key of ID_KEYS) {
    const v = params[key];
    if (typeof v !== "string" || !v || localIds.has(v)) continue;
    externals.push({ step: i, op, param: key, id: v });
    // 离线装置不该顺带判"这个外部 id 是什么类型"——给出期望类型，免得撞出假错误
    h.hintRef(v, op === "create-instance" && (key === "componentId" || key === "id") ? "COMPONENT" : "FRAME");
  }

  /* 试跑：拿真源码当契约裁判 */
  try {
    const data = await h.handlers[op](params);
    if (data && data.created && data.created.id) {
      lastCreatedId = data.created.id;
      localIds.add(data.created.id);
      if (typeof step.as === "string" && step.as) named.set(step.as, data.created.id);
    }
    okSteps.push(i);
  } catch (e) {
    const code = e && e.code;
    if (code) {
      errors.push({ at, op, msg: `${code}: ${e.message}`, code });
    } else {
      gaps.push({ at, op, msg: (e && e.message) || String(e) });
    }
  }
}

/* ---------------- 输出（离线部分） ---------------- */

const bar = "=".repeat(62);
console.log(bar);
console.log(`precheck —— 构建计划预检（1.2 B1 离线）`);
console.log(`计划：${path.relative(ROOT, path.resolve(file)).split(path.sep).join("/")}（${shape}，${steps.length} 步）`);
console.log(bar);

if (!QUIET) for (const i of okSteps) console.log(`  ok    step ${i}  ${steps[i].op}`);

for (const g of gaps) console.log(`  WARN  ${g.at} (${g.op}) 装置缺口 —— ${g.msg}`);
for (const e of errors) console.log(`  FAIL  ${e.at}${e.op ? ` (${e.op})` : ""}  ${e.msg}`);

// 去重后的外部引用
const uniqExternal = [...new Map(externals.map((x) => [x.id, x])).values()];
if (uniqExternal.length) {
  console.log(bar);
  console.log(`  待核对的外部引用 ${uniqExternal.length} 个（离线**查不出**画布上是否存在）：`);
  for (const x of externals) console.log(`    step ${x.step} (${x.op}) ${x.param} = ${x.id}`);
  if (uniqExternal.length !== externals.length) {
    console.log(`    （去重后实际 ${uniqExternal.length} 个不同 id）`);
  }
}

console.log(bar);
// 这一行是**离线汇总**。`--live` 时后面还要做在线核对，必须再打一次「最终汇总」（见文件末）——
// 否则 §6 要求逐行粘的"汇总行"会停在核对**之前**的状态：汇总说「待核对 1」，
// 紧接着的 B2 段却已 `ok 存在`，读的人把「已核过」记成「没核」（1.3 · B2 缺陷）。
// 故 `--live` 时给这一行加标签，让它**不可能**被误当成最终结论。
console.log(
  `${LIVE ? "  离线汇总  " : "  "}${steps.length} 步：通过 ${okSteps.length} ｜ 错误 ${errors.length} ｜ 装置缺口 ${gaps.length} ｜ 待核对 ${uniqExternal.length}`,
);
if (h.stats.autoVivified.length) {
  console.log(`  （离线装置按需造了 ${h.stats.autoVivified.length} 个虚拟节点，仅为了让流程跑下去；这不代表它们真的存在）`);
}

/* ---------------- 在线：B2 引用核对 ---------------- */

let liveFailed = false;
// 在线核对的可数结果 —— 供「最终汇总」行使用。分开记三个数才诚实：
// 「已核对」「核出不存在」「未核对」是三种不同状态，合成一个「N 个引用」会丢掉信息。
let liveChecked = 0;       // 已核对且**确认存在**的不同 id 数
let liveMissingCount = 0;  // 已核对且**确认不存在**的不同 id 数
if (LIVE) {
  console.log(bar);
  console.log("  B2 在线核对 —— 对上述外部引用逐个问真实画布");
  console.log("  边界：这是**核对**，不是仿真。Figma 无事务，做不到「先跑一遍再回滚」。");
  console.log(bar);

  const base = optOf("--url") || `http://127.0.0.1:${optOf("--port", process.env.VIBE_PORT || 45677)}`;
  let token = optOf("--token");
  if (!token) {
    const tf = path.join(ROOT, ".vibe", "token");
    if (fs.existsSync(tf)) token = fs.readFileSync(tf, "utf8").trim();
  }
  if (!token) {
    console.log(`  FAIL  拿不到 token —— 传 --token，或让 Bridge 先把 token 写到 .vibe/token`);
    liveFailed = true;
  } else {
    const api = async (route, body) => {
      const r = await fetch(`${base}${route}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    let health = null;
    try {
      health = await (await fetch(`${base}/health`)).json();
    } catch (e) {
      console.log(`  FAIL  连不上 Bridge（${base}）—— 先启动 node bridge/server.js · ${e.message}`);
      liveFailed = true;
    }
    if (health && !liveFailed) {
      const connected = health.plugin && health.plugin.connected;
      console.log(`  ${connected ? "ok  " : "FAIL"} 插件连接状态：${connected ? "已连接" : "未连接"}（${health.service}）`);
      if (!connected) {
        console.log("        → 插件没连上就核对不了画布。在 Figma 里运行插件并点 Connect 后重试。");
        liveFailed = true;
      }
    }

    if (!liveFailed && uniqExternal.length === 0) {
      console.log("  ok    没有字面 id 引用需要核对（本地创建物一律走 $name/@last）");
    }

    if (!liveFailed && uniqExternal.length) {
      const missing = new Map(); // id → [{step,op,param}]
      let unexpected = 0;
      for (const x of uniqExternal) {
        const res = await api("/v1/command", { op: "get-node", params: { id: x.id, depth: 0 } });
        const err = res.body && res.body.error;
        if (res.status === 200 && res.body && res.body.ok) {
          liveChecked++;
          if (!QUIET) console.log(`  ok    ${x.id} 存在（首次出现在 step ${x.step} 的 ${x.param}）`);
        } else if (err && err.code === "NODE_NOT_FOUND") {
          if (!missing.has(x.id)) missing.set(x.id, []);
          missing.get(x.id).push(...externals.filter((y) => y.id === x.id));
        } else {
          console.log(`  FAIL  核对 ${x.id} 时收到意外响应：${res.status} ${JSON.stringify(err || res.body)}`);
          unexpected++;
        }
      }
      for (const [id, uses] of missing) {
        for (const u of uses) {
          console.log(`  FAIL  step ${u.step} (${u.op}) 的 ${u.param} = ${id} —— 画布上不存在这个节点`);
        }
      }
      liveMissingCount = missing.size;
      // 注意顺序：只有在「没有任何意外响应」时才敢说"全部存在"。
      // 否则一次超时/掉线会被误报成"全部核过"，那是把没查说成查过了。
      if (unexpected) {
        liveFailed = true;
      } else if (missing.size) {
        liveFailed = true;
      } else {
        console.log(`  ok    外部引用全部存在于画布（${uniqExternal.length} 个）`);
      }
    }
  }
}

/* ---------------- 在线核对后的最终汇总 ---------------- */

/**
 * 为什么必须再打一次汇总行（1.3 · B2）：
 * `references/acceptance-criteria.md` §6 的留痕纪律要求逐行粘**工具汇总行 + 退出码**。
 * 而上面那行「离线汇总」是在在线核对**之前**打印的 —— 它写「待核对 16」，核对完却没再更新。
 * 于是产物里只剩一句过期的话，人把「已核过 16」记成「16 个没核」。
 * 这与 `lessons.md` #72 是**镜像关系**：那次是「没查」看起来像「查了」，这次是「查了」看起来像「没查」。
 * 同一个病根：**结论行的状态与它描述的事实脱节**。故凡有「先打印结论、后做核对」的结构，
 * 核对完必须重打一次，且两次都要能分辨（给前一次加限定词）。
 */
if (LIVE) {
  const verified = liveChecked;
  const missingN = liveMissingCount;
  const unverified = Math.max(0, uniqExternal.length - verified - missingN);
  console.log(bar);
  console.log(
    `  最终汇总（含在线核对）  ${steps.length} 步：通过 ${okSteps.length} ｜ 错误 ${errors.length} ｜ ` +
      `装置缺口 ${gaps.length} ｜ 外部引用 ${uniqExternal.length}（已核对 ${verified} ｜ 核出不存在 ${missingN} ｜ 未核对 ${unverified}）`,
  );
  // 「未核对 > 0」时把话说透：别让人把「没核」当「核过」。留着 checked 字段才敢这么说，
  // 否则 unverified 无处可算（这正是 #72 ②「答案要落在产物里」的落地）。
  if (unverified > 0 && !liveFailed) {
    console.log(`  ⚠  仍有 ${unverified} 个外部引用**未核对** —— 不得记为"已核对"（核对是否中止看上面的 FAIL）`);
  }
}

/* ---------------- 结论 ---------------- */

console.log(bar);
if (errors.length || liveFailed) {
  console.log(`\n结果：未通过 —— 修掉上面的 FAIL 再开工（离线错误 ${errors.length}${LIVE ? `；在线核对${liveFailed ? "未过" : "通过"}` : "；未做在线核对"}）`);
  process.exit(1);
}
if (gaps.length) {
  console.log(
    `\n结果：通过（有 ${gaps.length} 处**装置缺口**未覆盖 —— 不是计划的问题，是离线桩还没覆盖到那些宿主 API，` +
      `建议补进 tools/figma-harness.mjs）`,
  );
} else {
  console.log("\n结果：通过 —— 结构与契约错误 0（PRECHECK OK）");
}
process.exit(0);

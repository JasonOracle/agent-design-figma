#!/usr/bin/env node
/**
 * qa-install.mjs — 安装体验契约校验（L0）
 *
 * 校验对象是「新用户照文档装完，能不能真的用起来」，即 §A3 的安装契约在
 * README / SETUP / USER_GUIDE / references/runtime-capability.md / 探针 之间是否自洽。
 * 移植自上游 tools/stage10-7-install-qa.py（109 行 / 56 断言），但把「grep 关键token」
 * 换成「真跑探针，用它自己的输出当事实源」——理由见下。
 *
 * 九组检查：
 *   QA1  安装入口交付物存在（README / SETUP / USER_GUIDE / 探针 / bridge / plugin / VERSION）
 *   QA2  探针静态约束 —— 只读 · 零新协议 · 零外部依赖 · 公开端点不带 token
 *   QA3  三模式端到端 ★  —— 真 bridge / mock 插件 / 假 home，逐态对照 §3 Capability Matrix
 *   QA4  只读承诺（行为）★ —— --no-write 不落盘；不带则落在文档声称的默认路径
 *   QA5  cwd 无关性（行为）★ —— 从别的目录跑，仍读得到自身 VERSION、仍写技能目录
 *   QA6  四方口径一致 ★  —— 模式枚举锁死 + 「用户可见提示」逐字复算（不许手抄）
 *   QA7  安装合约事实（跨产物）★ —— 端口五处一致 · localhost 拼写 · ::1 绑定 · token 路径与持久性 · manifest
 *   QA8  SKILL.md 注册与降级铁律
 *   QA9  落盘产物形状（软）
 *
 * 为什么不用上游的「token 是否存在」写法：那种检查只能证明「这串字在文件里出现过」。
 * 文档写着 `未检测到 Figma 连接能力，仅可生成设计资产`，而探针实际吐的是带尾注的更长串——
 * 两者都「含有关键 token」，检查全绿，用户拿到的却是与文档不符的提示。
 * 所以本工具把**探针的实际输出**当事实源（可执行的是真的，手抄的只是声称），
 * 文档里凡以引号给出的用户可见提示，必须与实跑逐字相等。
 *
 * 硬 / 软两档：check() 进退出码；note() 只出 WARN。行为类检查若因环境跑不起来
 * （端口被占 / 起不来进程），记入「装置缺口」单列，**不算产品缺陷**——与 precheck 同一套三档口径。
 *
 * 用法：
 *   node tools/qa-install.mjs              # 校验本仓库
 *   node tools/qa-install.mjs --quiet
 *   node tools/qa-install.mjs --no-behavior   # 跳过需要起进程/起服务的行为检查（QA3/Q A4/Q5/Q7行为段）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ARGS = process.argv.slice(2);
const QUIET = ARGS.includes("--quiet");
const NO_BEHAVIOR = ARGS.includes("--no-behavior");

const pass = [];
const fail = [];
const warn = [];
const gaps = [];

const check = (ok, msg) => (ok ? pass : fail).push(msg);
const note = (msg) => warn.push(msg);
const gap = (msg) => gaps.push(msg);
const none = (arr) => (arr.length ? arr.join(" / ") : "无");

/**
 * 读交付物。文件不存在时返回 ""，**不抛**。
 * 校验器必须能如实报出「缺文件」——若它自己先崩成堆栈，就连它要抓的那个缺陷都报不出来，
 * 用户看到的只是一段 ENOENT，而真正的问题（SETUP.md 不见了）反而没被说出口。
 */
const read = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/* ---------------- 临时夹具 ---------------- */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-install-"));
const TMP_SKILL = path.join(TMP, "skill");
const TMP_HOME_READ = path.join(TMP, "home-read");
const TMP_HOME_OFF = path.join(TMP, "home-off");

function seedFixtures() {
  // 源文件缺失时**不抛**：缺文件本身该由 QA1 如实报出，而不是让工具崩成一段 ENOENT 堆栈。
  const copyIf = (rel, dst) => {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
      gap(`装置缺口：${rel} 不存在，依赖它的行为检查无法进行（缺文件本身由 QA1 报出）`);
      return false;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
  };

  // 最小技能副本：只要探针 + VERSION，足以复现「路径自我定位」与落盘行为
  copyIf("tools/runtime-check.mjs", path.join(TMP_SKILL, "tools", "runtime-check.mjs"));
  copyIf("VERSION", path.join(TMP_SKILL, "VERSION"));
  // 真 bridge 副本（它只 require node 内建，且 ROOT 由 __dirname 上溯 → token 落在临时目录）
  copyIf("bridge/server.js", path.join(TMP, "bridge", "server.js"));

  // 假 home：一份有读取型 Figma MCP，一份没有
  fs.mkdirSync(path.join(TMP_HOME_READ, ".workbuddy"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_HOME_READ, ".workbuddy", "mcp.json"),
    JSON.stringify({ mcpServers: { "figma-context": { command: "npx", args: ["-y", "figma-context-mcp"] } } })
  );
  fs.mkdirSync(path.join(TMP_HOME_OFF, ".workbuddy"), { recursive: true });
  fs.writeFileSync(path.join(TMP_HOME_OFF, ".workbuddy", "mcp.json"), JSON.stringify({ mcpServers: {} }));
}

/* ---------------- 进程 / 网络小工具 ---------------- */

/**
 * 异步跑探针。
 * **不能用 execFileSync**：它阻塞事件循环，同进程的 mock 服务永远不会应答（同 precheck 的 B2 教训）。
 * stdout 与 stderr 必须**分开收集**：探针把 capability JSON 写 stdout、把「capability written: …」
 * 这类人为提示写 stderr（这个分工是对的，别让工具去合并它们，否则 JSON 解析必挂）。
 */
function runProbe({ script, env = {}, cwd = ROOT, args = ["--no-write"] }) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, AGENT_BRIDGE_URL: "http://127.0.0.1:1", ...env }, // 默认指向确定无人的端口
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(out); } catch { /* 留给断言报错 */ }
      resolve({ code, out, err, json });
    });
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起一份真 bridge，等到 /health 应答，返回 {child, health, base, token} */
async function startBridge({ port, dir }) {
  const child = spawn(process.execPath, [path.join(dir, "bridge", "server.js")], {
    cwd: dir,
    env: { ...process.env, VIBE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  // base 不带 /health：探针自己会拼 `${BRIDGE_URL}/health`。
  // 曾经这里返回的是含 /health 的完整 URL，结果探针去请求 /health/health 得 404，
  // 于是一路退化成「没有 bridge」——用例照样「通过」，是通过得毫无意义（变异测试抓出来的）。
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    const h = await getJson(`${base}/health`);
    if (h) return { child, health: h, log, base };
    if (child.exitCode !== null) break;
  }
  child.kill();
  return { child: null, health: null, log, base: null };
}

function getJson(url) {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1200);
    fetch(url, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => resolve(j))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(t));
  });
}

/** 起一个只回 /health 的 mock，payload 由调用方给定 */
async function startHealthMock(port, payload) {
  const srv = http.createServer((req, res) => {
    if (req.url.split("?")[0] === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  return srv;
}

seedFixtures();

/* ================= QA1 安装入口交付物存在 ================= */

const INSTALL_SURFACE = [
  "README.md",
  "README_EN.md",
  "SETUP.md",
  "USER_GUIDE.md",
  "SKILL.md",
  "CHANGELOG.md",
  "VERSION",
  "references/runtime-capability.md",
  "tools/runtime-check.mjs",
  "tools/qa-plugin.mjs",
  "bridge/server.js",
  "figma-plugin/manifest.json",
  "figma-plugin/code.js",
  "figma-plugin/ui.html",
];
const missing = INSTALL_SURFACE.filter((f) => !exists(f));
check(missing.length === 0, `QA1 安装入口交付物齐备（缺 ${none(missing)}）`);

/* ================= QA2 探针静态约束 ================= */

const probeSrc = read("tools/runtime-check.mjs");

check(probeSrc.includes("/health"), "QA2 探针复用 Bridge 公开端点 /health");
check(!probeSrc.includes("POST"), "QA2 探针无写操作（源码不含 POST）");
check(!probeSrc.includes("new Server") && !/\blisten\(/.test(probeSrc), "QA2 探针不创建新协议/服务");
check(probeSrc.includes("mcp.json"), "QA2 探针读 MCP 配置判定读能力");

// 判「代码里真的做了这个判断」，不判「文中出现过这个名字」。
// 这些名字在探针头部注释里也出现（「存在启用的 Figma MCP（figma-context / figma-developer-mcp / framelink）」），
// 用 includes 会被注释喂饱——把真正的判定分支删掉反而不报警（变异测试抓出的）。
// 期望名单由 canonical 文档派生，不写死：文档声明认得哪些，代码里就必须真的在判哪些。
const docMcpNames = ["figma-context", "figma-developer-mcp", "framelink"].filter((n) =>
  read("references/runtime-capability.md").includes(n)
);
const notJudged = docMcpNames.filter((n) => !new RegExp(`haystack\\.includes\\("${n}"\\)`).test(probeSrc));
check(
  docMcpNames.length >= 2 && notJudged.length === 0,
  `QA2 文档声明的已知读取型 MCP 探针都在判定逻辑里认（未判定：${none(notJudged)}；名单 ${docMcpNames.length} 个）`
);

// 零外部依赖（SETUP / runtime-capability 都写了「node，无外部依赖」）
const imports = probeSrc.match(/^\s*import .*$/gm) || [];
const nonBuiltin = imports.filter((l) => !/from\s+"node:/.test(l));
check(imports.length > 0 && nonBuiltin.length === 0, `QA2 探针零外部依赖（非内建 import：${none(nonBuiltin)}）`);

// 公开端点不带 token：判形状（token= / x-vibe-token），不判「出现过 token 这个词」——注释里本来就有
const tokenShapes = [/token=/, /x-vibe-token/].filter((re) => re.test(probeSrc));
check(tokenShapes.length === 0, `QA2 探针对 /health 不带 token（命中形状 ${tokenShapes.length} 个）`);

/* ================= QA6 四方口径一致（先算真值，供后面复用） ================= */

const PKG_DOCS = [
  "README.md",
  "README_EN.md",
  "SETUP.md",
  "USER_GUIDE.md",
  "SKILL.md",
  "CHANGELOG.md",
  ...fs
    .readdirSync(path.join(ROOT, "references"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `references/${f}`),
];
const docText = Object.fromEntries(PKG_DOCS.filter(exists).map((f) => [f, read(f)]));

// 模式枚举锁：包内文档只许出现锁死的三种模式
const MODES = ["FULL_MODE", "READ_ONLY_MODE", "OFFLINE_MODE"];
const invented = new Map();
for (const [f, t] of Object.entries(docText)) {
  for (const m of t.match(/\b[A-Z][A-Z_]*_MODE\b/g) || []) {
    if (!MODES.includes(m)) invented.set(m, [...(invented.get(m) || []), f]);
  }
}
check(
  invented.size === 0,
  `QA6 模式枚举锁死（编造的模式：${invented.size ? [...invented].map(([m, fs_]) => `${m}@${fs_[0]}`).join(" / ") : "无"}）`
);

/* ================= QA3 三模式端到端 ================= */

const VERSION = read("VERSION").trim();
const REQUIRED_KEYS = ["figmaRead", "figmaWrite", "executor", "mode"];
/** 探针输出的通用形状断言，返回解析好的 json */
function assertCapabilityShape(tag, r) {
  check(r.code === 0, `QA3 ${tag} 探针可执行（exit 0，实际 ${r.code}）`);
  check(r.json !== null, `QA3 ${tag} stdout 可解析为 JSON`);
  if (!r.json) return null;
  const c = r.json;
  check(REQUIRED_KEYS.every((k) => k in c), `QA3 ${tag} 输出含 ${REQUIRED_KEYS.join("/")} 四个必备键`);
  check(MODES.includes(c.mode), `QA3 ${tag} mode 枚举合法（${c.mode}）`);
  check(typeof c.figmaRead === "boolean" && typeof c.figmaWrite === "boolean", `QA3 ${tag} figmaRead/figmaWrite 为布尔`);
  check(
    (c.executor === "figma-plugin-bridge") === Boolean(c.figmaWrite),
    `QA3 ${tag} executor 与 figmaWrite 自洽（executor=${JSON.stringify(c.executor)} / write=${c.figmaWrite}）`
  );
  const expect = c.figmaWrite ? "FULL_MODE" : c.figmaRead ? "READ_ONLY_MODE" : "OFFLINE_MODE";
  check(c.mode === expect, `QA3 ${tag} mode 与能力组合自洽（无假 FULL_MODE：mode=${c.mode} 期望 ${expect}）`);
  check(typeof c.version === "string" && c.version === VERSION, `QA3 ${tag} version 与 VERSION 文件一致（${c.version}）`);
  return c;
}

/* ---- 提示语真值：轻量恒跑（只跑探针两次，不起 bridge / mock）---- */
// QA6 的「逐字复算」是**文档**检查，不能被 --no-behavior 连坐：取真值只需要探针 + 假 home，
// 与一次文件读取同量级。若把它一起跳过，最值钱的那条检查会在降级模式下静默消失——
// 而「静默消失的检查」正是本工具存在的理由（lessons #33）。
const PROBE = path.join(TMP_SKILL, "tools", "runtime-check.mjs");
let hintReadOnly = null;
let hintOffline = null;
{
  const rRo0 = await runProbe({ script: PROBE, env: { HOME: TMP_HOME_READ, USERPROFILE: TMP_HOME_READ } });
  hintReadOnly = rRo0.json?.details?.hints ?? null;
  const rOff0 = await runProbe({ script: PROBE, env: { HOME: TMP_HOME_OFF, USERPROFILE: TMP_HOME_OFF } });
  hintOffline = rOff0.json?.details?.hints ?? null;
}
check(hintReadOnly !== null, "QA6 探针 READ_ONLY_MODE 输出含降级提示语（复算的事实源）");
check(hintOffline !== null, "QA6 探针 OFFLINE_MODE 输出含降级提示语（复算的事实源）");

if (NO_BEHAVIOR) {
  gap("QA3 已按 --no-behavior 跳过三模式端到端行为检查");
} else {
  // ① 真 bridge 的 /health 形状（顺便取到 port 供 QA7 运行时核对）
  const bridgePort = await freePort();
  const bridge = await startBridge({ port: bridgePort, dir: TMP });

  if (!bridge.health) {
    gap(`QA3 真 bridge 起不来（freePort=${bridgePort}），三模式端到端降级为 mock-only。日志：${bridge.log.slice(0, 200)}`);
  } else {
    check(bridge.health.service === "agent-design-figma-bridge", `QA3 真 bridge /health.service = agent-design-figma-bridge`);
    check(bridge.health.ok === true, "QA3 真 bridge /health.ok = true");
    check(
      bridge.health.port === bridgePort && bridge.health.host === "127.0.0.1",
      `QA3 真 bridge /health 回显自身 host:port（${bridge.health.host}:${bridge.health.port}）`
    );

    // ② 真 bridge 可达但插件未连 → 读写都 false（§1 明写：插件没连等于两样都没有）
    const rUp = await runProbe({
      script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"),
      env: { AGENT_BRIDGE_URL: bridge.base, HOME: TMP_HOME_OFF, USERPROFILE: TMP_HOME_OFF },
    });
    const cUp = assertCapabilityShape("bridge可达/插件未连", rUp);
    if (cUp) {
      check(
        cUp.mode === "OFFLINE_MODE" && cUp.figmaWrite === false && cUp.figmaRead === false,
        `QA3 bridge 可达但 plugin.connected=false → 读写皆 false（实测 ${cUp.mode} / read=${cUp.figmaRead} / write=${cUp.figmaWrite}）`
      );
    }

    // ③ mock 插件已连 → FULL_MODE。payload 由真 /health 派生，不手抄字段名
    const mockPayload = { ...bridge.health, plugin: { connected: true, label: "agent-design-figma Bridge (Dev)", info: { editorType: "figma" } } };
    const mockPort = await freePort();
    const mock = await startHealthMock(mockPort, mockPayload);
    const rFull = await runProbe({
      script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"),
      env: { AGENT_BRIDGE_URL: `http://127.0.0.1:${mockPort}`, HOME: TMP_HOME_OFF, USERPROFILE: TMP_HOME_OFF },
    });
    mock.close();
    const cFull = assertCapabilityShape("FULL_MODE", rFull);
    if (cFull) {
      check(
        cFull.mode === "FULL_MODE" && cFull.figmaWrite === true && cFull.figmaRead === true,
        `QA3 插件在位 → FULL_MODE 且读写皆 true（实测 ${cFull.mode} / read=${cFull.figmaRead} / write=${cFull.figmaWrite}）`
      );
      check(cFull.executor === "figma-plugin-bridge", `QA3 FULL_MODE executor = figma-plugin-bridge`);
      check(cFull.details?.hints === null, `QA3 FULL_MODE 不吐降级提示（hints=${JSON.stringify(cFull.details?.hints)}）`);
      check(
        Array.isArray(cFull.details?.readSources) && cFull.details.readSources.some((s) => s.startsWith("bridge:")),
        `QA3 FULL_MODE 标注读能力来源为 bridge（readSources=${JSON.stringify(cFull.details?.readSources)}）`
      );
    }
    bridge.child.kill();
  }

  // ④ 无 bridge + 假 home 有读取型 MCP → READ_ONLY_MODE
  const rRo = await runProbe({
    script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"),
    env: { HOME: TMP_HOME_READ, USERPROFILE: TMP_HOME_READ },
  });
  const cRo = assertCapabilityShape("READ_ONLY_MODE", rRo);
  if (cRo) {
    check(
      cRo.mode === "READ_ONLY_MODE" && cRo.figmaWrite === false && cRo.figmaRead === true,
      `QA3 仅读 MCP → READ_ONLY_MODE（实测 ${cRo.mode} / read=${cRo.figmaRead} / write=${cRo.figmaWrite}）`
    );
  }

  // ⑤ 无 bridge + 假 home 无 MCP → OFFLINE_MODE（并再取一次提示语真值）
  const rOff = await runProbe({
    script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"),
    env: { HOME: TMP_HOME_OFF, USERPROFILE: TMP_HOME_OFF },
  });
  const cOff = assertCapabilityShape("OFFLINE_MODE", rOff);
  if (cOff) {
    check(
      cOff.mode === "OFFLINE_MODE" && cOff.figmaWrite === false && cOff.figmaRead === false,
      `QA3 无任何连接能力 → OFFLINE_MODE（实测 ${cOff.mode}）`
    );
  }

  // ⑥ disabled 的 Figma MCP 不算读能力（探针明写跳过 disabled）
  const homeDisabled = path.join(TMP, "home-disabled");
  fs.mkdirSync(path.join(homeDisabled, ".workbuddy"), { recursive: true });
  fs.writeFileSync(
    path.join(homeDisabled, ".workbuddy", "mcp.json"),
    JSON.stringify({ mcpServers: { "figma-context": { command: "npx", args: ["figma-context-mcp"], disabled: true } } })
  );
  const rDis = await runProbe({
    script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"),
    env: { HOME: homeDisabled, USERPROFILE: homeDisabled },
  });
  if (rDis.json) {
  check(
    rDis.json.figmaRead === false && rDis.json.mode === "OFFLINE_MODE",
    `QA3 disabled 的 Figma MCP 不计入读能力（实测 mode=${rDis.json.mode} / read=${rDis.json.figmaRead}）`
  );
  }
}

/* ================= QA4 只读承诺（行为） ================= */

if (NO_BEHAVIOR) {
  gap("QA4 已按 --no-behavior 跳过只读承诺行为检查");
} else {
  const capPath = path.join(TMP_SKILL, ".vibe", "runtime-capability.json");
  if (exists2(capPath)) fs.unlinkSync(capPath);

  const rNoWrite = await runProbe({ script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"), args: ["--no-write"] });
  check(rNoWrite.code === 0, `QA4 --no-write 可执行（exit ${rNoWrite.code}）`);
  check(!exists2(capPath), "QA4 --no-write 不落盘（探针只读承诺）");

  const rWrite = await runProbe({ script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"), args: [] });
  check(exists2(capPath), "QA4 不带 --no-write 时落盘到 <skill 根>/.vibe/runtime-capability.json");
  if (exists2(capPath)) {
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(capPath, "utf8")); } catch { /* 下面断言即失败 */ }
    check(disk !== null && REQUIRED_KEYS.every((k) => k in disk) && MODES.includes(disk.mode), "QA4 落盘 capability JSON 形状正确");
    check(
      disk && rWrite.json && disk.mode === rWrite.json.mode,
      `QA4 落盘内容与 stdout 一致（盘 ${disk?.mode} vs stdout ${rWrite.json?.mode}）`
    );
  }
}

/* ================= QA5 cwd 无关性（行为） ================= */

if (NO_BEHAVIOR) {
  gap("QA5 已按 --no-behavior 跳过 cwd 无关性行为检查");
} else {
  const elsewhere = path.join(TMP, "somewhere-else");
  fs.mkdirSync(elsewhere, { recursive: true });
  const capPath = path.join(TMP_SKILL, ".vibe", "runtime-capability.json");
  if (exists2(capPath)) fs.unlinkSync(capPath);

  const r = await runProbe({ script: path.join(TMP_SKILL, "tools", "runtime-check.mjs"), args: [], cwd: elsewhere });
  check(r.json !== null && r.json.version === VERSION, `QA5 别处 cwd 仍读得到自身 VERSION（${r.json?.version}）`);
  check(exists2(capPath), "QA5 别处 cwd 仍写技能目录（不受 cwd 影响）");
  check(!exists2(path.join(elsewhere, ".vibe", "runtime-capability.json")), "QA5 不在 cwd 下误建 .vibe/");
}

/* ================= QA6 提示语逐字复算 ================= */

if (hintReadOnly && hintOffline) {
  const canon = "references/runtime-capability.md";
  const quoteScan = (truth) => {
    const prefix = truth.split("，")[0]; // 形状前缀由真值派生，不写死
    const re = new RegExp(`["“](${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"”\\n]*)["”]`, "g");
    const found = [];
    for (const [f, t] of Object.entries(docText)) {
      for (const m of t.matchAll(re)) found.push({ file: f, quote: m[1] });
    }
    return found;
  };

  const roQuotes = quoteScan(hintReadOnly);
  const offQuotes = quoteScan(hintOffline);

  // ① 覆盖度：引用 READ_ONLY 提示的文档数（防「把承诺整段删掉」让检查空转）
  check(roQuotes.length >= 4, `QA6 引用 READ_ONLY 提示的文档数 ≥4（实际 ${roQuotes.length}：${[...new Set(roQuotes.map((q) => q.file))].join(", ")}）`);
  check(offQuotes.length >= 1, `QA6 canonical 文档给出 OFFLINE 提示（实际 ${offQuotes.length} 处）`);
  check(offQuotes.some((q) => q.file === canon), `QA6 ${canon} 给出 OFFLINE 提示（Capability Matrix 是契约锚点）`);

  // ② 逐字：文档里引号住的用户可见提示，必须与探针实跑的输出一字不差
  for (const q of roQuotes) {
    check(q.quote === hintReadOnly, `QA6 ${q.file} 的 READ_ONLY 提示与探针实跑逐字一致`);
  }
  for (const q of offQuotes) {
    check(q.quote === hintOffline, `QA6 ${q.file} 的 OFFLINE 提示与探针实跑逐字一致（引文「${q.quote}」应等于「${hintOffline}」）`);
  }

  // ③ 反直觉规则必须到处都写着：FULL_MODE 下 figmaRead 也为 true
  const fullReadDocs = ["README.md", "README_EN.md", "SETUP.md", "SKILL.md", canon];
  for (const f of fullReadDocs) {
    const t = docText[f] ?? "";
    check(
      t.includes("FULL_MODE") && /figmaRead/.test(t) && /\btrue\b/.test(t),
      `QA6 ${f} 写明「FULL_MODE 下 figmaRead 同为 true」（否则用户会把正常读成环境残缺）`
    );
  }
} else {
  gap("QA6 提示语逐字复算缺少探针真值（行为段被跳过或探针未能产出提示语）");
}

/* ================= QA7 安装合约事实（跨产物） ================= */

const bridgeSrc = read("bridge/server.js");
const uiSrc = read("figma-plugin/ui.html");

// 清单解析失败不许把整支工具带走：报一条 FAIL，其余检查照跑（缺文件由 QA1 负责说清）
let manifest = null;
try {
  manifest = JSON.parse(read("figma-plugin/manifest.json"));
} catch {
  /* 下面 check 会报 */
}
check(manifest !== null && typeof manifest === "object", "QA7 figma-plugin/manifest.json 可解析为 JSON");
const mf = manifest ?? {};

// 端口：源码默认值 / 插件清单 / 插件界面 三处必须同值
const serverPort = Number((bridgeSrc.match(/VIBE_PORT\s*\|\|\s*(\d+)/) || [])[1]);
const manifestPort = Number((JSON.stringify(mf.networkAccess?.allowedDomains || []).match(/localhost:(\d+)/) || [])[1]);
const uiPort = Number((uiSrc.match(/localhost:(\d+)/) || [])[1]);
const docPort = Number((read("SETUP.md").match(/127\.0\.0\.1:(\d+)/) || [])[1]);

check(Number.isFinite(serverPort), `QA7 bridge 源码有声明的默认端口（${serverPort}）`);
check(
  serverPort === manifestPort && serverPort === uiPort && serverPort === docPort,
  `QA7 端口四处一致：server=${serverPort} / manifest=${manifestPort} / ui.html=${uiPort} / SETUP=${docPort}`
);

// Figma 校验器只接受 localhost 拼写；插件侧不得写成 127.0.0.1
const manifestDomains = mf.networkAccess?.allowedDomains || [];
check(manifestDomains.length > 0 && manifestDomains.every((d) => d.includes("localhost")), `QA7 插件清单只用 localhost 拼写（Figma 拒绝 127.0.0.1）`);
check(uiSrc.includes("CANDIDATE_BASES") && /CANDIDATE_BASES\s*=\s*\[\s*"http:\/\/localhost:/.test(uiSrc), "QA7 插件界面候选基址用 localhost 拼写");
// 既然插件只能连 localhost，bridge 就必须同时绑 ::1，否则解析到 ::1 的机器连不上
// 判常量与真实的 listen 调用，不判「文中出现过 ::1」——它在本文件注释里也出现过两处
check(
  /const LOOPBACK_V6 = "::1"/.test(bridgeSrc) && /\.listen\(PORT,\s*LOOPBACK_V6/.test(bridgeSrc),
  "QA7 bridge 同时绑 ::1（否则 localhost 解析到 ::1 时插件连不上）"
);
check(/HOST\s*=\s*"127\.0\.0\.1"/.test(bridgeSrc), "QA7 bridge 只绑回环地址（不对外网开放）");

// 运行时核对：真 bridge 的 /health.port 必须等于声明端口（静态一致不代表跑起来一致）
if (!NO_BEHAVIOR && Number.isFinite(serverPort)) {
  const live = await getJson(`http://127.0.0.1:${serverPort}/health`);
  if (live && live.service === "agent-design-figma-bridge") {
    check(live.port === serverPort, `QA7 运行时校验：监听中的 bridge /health.port = ${live.port}（声明 ${serverPort}）`);
  } else {
    note(`QA7 运行时校验跳过：默认端口 ${serverPort} 上没有运行中的 bridge（静态四处一致已核）`);
  }
}

// token 文件路径 + 持久性
check(/TOKEN_FILE\s*=\s*path\.join\(ROOT,\s*"\.vibe",\s*"token"\)/.test(bridgeSrc), "QA7 bridge token 文件固定在 <仓库根>/.vibe/token");
check(/ROOT\s*=\s*path\.resolve\(__dirname,\s*"\.\."\)/.test(bridgeSrc), "QA7 bridge 根目录由脚本自身定位（不受 cwd 影响）");
check((docText["references/bridge-ops.md"] ?? "").includes(".vibe/token"), "QA7 bridge-ops.md 与源码对同一 token 文件口径一致");

// token 的位置必须被绑定到「仓库目录」而不是「运行目录/cwd」——bridge 用 __dirname 上溯取 ROOT，
// 说成「运行目录」会让人以为它跟着 cwd 走，从别处启动时对行为产生错误预期。
// 判形状而非判行：只看**真正在陈述 token 文件位置**的那些行（即把该路径当主语说「在/位于 X」），
// 而不是任何顺带提到它的句子——否则「`--token` 不写入 `.vibe/token`」这类讨论落盘行为的句子
// 会被误判成「没绑定到仓库目录」（2026-09-16 补 #49 断言时自己踩到）。
const tokenLines = [];
for (const [f, t] of Object.entries(docText)) {
  for (const line of t.split("\n")) if (line.includes(".vibe/token")) tokenLines.push({ file: f, line });
}
const isLocationClaim = (line) => /(在|位于|存在|存放|落在|保存)[^。；]{0,12}`\.vibe\/token`/.test(line);
const unbound = tokenLines
  .filter(({ line }) => isLocationClaim(line) && !/仓库|\brepo\b|skill 根|技能目录/.test(line))
  .map((x) => x.file);
const locationClaims = tokenLines.filter(({ line }) => isLocationClaim(line));
check(
  locationClaims.length > 0 && unbound.length === 0,
  `QA7 陈述 token 文件位置的行都绑定到仓库目录而非 cwd（共 ${locationClaims.length} 处，未绑定：${none(unbound)}）`
);

check(read(".gitignore").includes(".vibe/"), "QA7 .gitignore 忽略 .vibe/（否则 token 会被提交进仓库）");

if (!NO_BEHAVIOR) {
  const t1 = await bridgeTokenOnce();
  const t2 = await bridgeTokenOnce();
  if (t1 && t2) {
    check(t1 === t2, `QA7 token 跨重启保持稳定（${t1.slice(0, 8)}… 两次一致）`);
  } else {
    gap("QA7 token 持久性行为检查未跑成（bridge 未能在临时目录起来）");
  }
}

async function bridgeTokenOnce() {
  const port = await freePort();
  const dir = path.join(TMP, "skill"); // 复用临时技能副本所在树
  const child = spawn(process.execPath, [path.join(TMP, "bridge", "server.js")], {
    cwd: dir,
    env: { ...process.env, VIBE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  child.stdout.on("data", (d) => (buf += d));
  child.stderr.on("data", (d) => (buf += d));
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const m = buf.match(/token:\s*([0-9a-f]{8,})/);
    if (m) {
      child.kill();
      await sleep(150);
      return m[1];
    }
    if (child.exitCode !== null) break;
  }
  child.kill();
  return null;
}

// `loadOrCreateToken()` 有四条返回路径，**只有最后一条会写 .vibe/token**：
//   --token <值>  → 直接返回，不落盘
//   VIBE_TOKEN    → 直接返回，不落盘
//   已有文件       → 读取，不写
//   都没有         → 生成 + 落盘   ← 唯一会写的路径
// 所以用 --token 启动时，文档若声称「.vibe/token 就是当前 token」即为**过度声称**：
// 照它取值必然 401（2026-09-16 真实环境实测踩到）。这里把该分支锁住：
// 断言「带 --token 启动不会把该值写进 .vibe/token」，并断言文档已写明以启动日志为准。
if (!NO_BEHAVIOR) {
  const dictToken = "deadbeefdeadbeefdeadbeefdeadbeef";
  const res = await tokenFileAfterArgToken(dictToken);
  if (res === null) {
    // 装置缺口 —— 但要能区分「bridge 起不来」与「bridge 副本不存在（夹具本身错了）」，
    // 后者属于**装置自己的缺陷**，不该被当成环境性降级混过去。
    if (!fs.existsSync(path.join(TMP, "bridge", "server.js"))) {
      check(false, "QA7 装置自检：<TMP>/bridge/server.js 副本存在（否则 token 行为检查恒被跳过）");
    } else {
      gap("QA7「--token 不落盘」行为检查未跑成（bridge 未能在临时目录起来）");
    }
  } else {
    check(
      res.value !== dictToken,
      `QA7 带 --token 启动时不得把该值写入 .vibe/token（实际 ${res.value === null ? "文件不存在" : JSON.stringify(res.value)}）`
    );
    // 该路径连文件都不写（`--token` 直接 return，走不到落盘那一步）；
    // 若文件恰好已存在（先前默认启动留下的），它必须**保持原值**而不是被覆盖。
    check(
      res.value === null || res.value.length >= 8,
      `QA7 带 --token 启动不破坏已存在的 token 文件（${res.value === null ? "本就不存在，符合预期" : `${res.value.length} 字符`}）`
    );
  }
}

// 文档告警是**纯静态**检查，与行为段无关，必须恒跑。
// （曾错放进上面的 `if (!NO_BEHAVIOR)` 里——那是 lessons #47「降级开关连坐」的同一个坑：
//  `--no-behavior` 一开，最值钱的文档一致性检查就静默消失，而汇总看着仍诚实。）
{
  const tokenDocSources = [
    ["SETUP.md", read("SETUP.md")],
    ["references/bridge-ops.md", docText["references/bridge-ops.md"] ?? ""],
  ];
  const notWarned = tokenDocSources.filter(([, t]) => !/以启动日志|启动日志打印|以.*打印.*为准/.test(t)).map(([f]) => f);
  check(
    notWarned.length === 0,
    `QA7 提到 token 取值的文档都写明「以启动日志为准」（未写明：${none(notWarned)}）`
  );
}

// 带 --token 起一份 bridge，读该实例的 `.vibe/token` 状态。
// 路径必须与 `bridgeTokenOnce` 一致：脚本在 `<TMP>/bridge/server.js`，
// 其 ROOT 由 `__dirname` 上溯一位 = `<TMP>`，故 token 落在 `<TMP>/.vibe/token`。
// （曾误写成 `<TMP>/skill/bridge/...` 与 `<TMP>/skill/.vibe/token` —— 那里根本没有 bridge 副本，
//  进程起不来 → 返回 null → 走 gap() 静默跳过，断言"通过"但其实什么都没测。
//  这正是 lessons #48「变异后仍绿的用例更值得看」与 #47「降级连坐」的同一个坑。）
// 返回 `{ value }`：value = 文件内容，null 表示文件不存在。
async function tokenFileAfterArgToken(given) {
  const port = await freePort();
  const script = path.join(TMP, "bridge", "server.js");
  const tokenFile = path.join(TMP, ".vibe", "token");
  if (!fs.existsSync(script)) return null;
  const child = spawn(process.execPath, [script, "--port", String(port), "--token", given], {
    cwd: path.join(TMP, "skill"), // 故意用一个不相干的 cwd，顺带证明 token 路径与 cwd 无关
    env: { ...process.env, VIBE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  child.stdout.on("data", (d) => (buf += d));
  child.stderr.on("data", (d) => (buf += d));
  let up = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    // 等到它真的把 --token 认下来（启动日志会回显该 token 的前缀）
    if (buf.includes(given.slice(0, 8))) {
      up = true;
      break;
    }
    if (child.exitCode !== null) break;
  }
  if (!up) {
    child.kill();
    return null;
  }
  let value = null;
  try {
    value = fs.readFileSync(tokenFile, "utf8").trim();
  } catch {
    value = null;
  }
  child.kill();
  await sleep(150);
  return { value };
}

// manifest 与 SETUP 让用户选的插件名一致；main/ui 指向的文件真实存在
check(mf.main === "code.js" && exists("figma-plugin/code.js"), "QA7 manifest.main 指向存在的 code.js");
check(mf.ui === "ui.html" && exists("figma-plugin/ui.html"), "QA7 manifest.ui 指向存在的 ui.html");
check(
  typeof mf.name === "string" && mf.name !== "" && read("SETUP.md").includes(mf.name),
  `QA7 SETUP 写出的插件名与 manifest.name 一致（manifest.name=${JSON.stringify(mf.name)}）`
);

/* ================= QA8 SKILL.md 注册与降级铁律 ================= */

const skillMd = read("SKILL.md");
check(skillMd.includes("runtime-check"), "QA8 SKILL.md 注册 runtime-check 探针入口");
check(MODES.every((m) => skillMd.includes(m)), "QA8 SKILL.md 注册三模式路由");
// 只认「未跑的层不得假装跑过 / 执行」这层意思：SKILL.md 另一处「不得假装被守卫」是另一条规则，
// 宽泛地 match「不得假装」会让降级铁律被删掉也照样绿（变异测试抓出的）。
check(/不得假装(跑过|执行)|不会假装(跑过|执行)/.test(skillMd), "QA8 SKILL.md 声明诚实铁律（未跑的层不得假装跑过/执行）");
check(skillMd.includes("SETUP.md"), "QA8 SKILL.md 指向 SETUP.md 安装指南");

/* ================= QA9 落盘产物形状（软） ================= */

const repoCap = path.join(ROOT, ".vibe", "runtime-capability.json");
if (fs.existsSync(repoCap)) {
  let c = null;
  try { c = JSON.parse(fs.readFileSync(repoCap, "utf8")); } catch { /* 下面报 */ }
  if (!c || !REQUIRED_KEYS.every((k) => k in c) || !MODES.includes(c.mode)) {
    note("QA9 仓库内 .vibe/runtime-capability.json 形状不合法（该文件为运行时产物，非交付物）");
  } else {
    pass.push("QA9 仓库内 .vibe/runtime-capability.json 形状合法");
    // 不与本次 mock 的 FULL_MODE 比（那个模式是合成的，比了就是自己造噪声）；
    // 只查它自身是否自洽、以及是否落后于当前版本。
    const expect = c.figmaWrite ? "FULL_MODE" : c.figmaRead ? "READ_ONLY_MODE" : "OFFLINE_MODE";
    if (c.mode !== expect) note(`QA9 落盘 capability 自身不自洽（mode=${c.mode} 与读写布尔 ${c.figmaRead}/${c.figmaWrite} 对不上）`);
    if (c.version !== VERSION) note(`QA9 落盘 capability 是旧版本快照（盘 ${c.version} vs 当前 ${VERSION}）——运行时产物，重跑探针即刷新`);
  }
} else {
  note("QA9 仓库内无 .vibe/runtime-capability.json（尚未跑过探针；非缺陷）");
}

/* ================= 汇总 ================= */

fs.rmSync(TMP, { recursive: true, force: true });

const bar = "=".repeat(62);
console.log(bar);
if (!QUIET) for (const m of pass) console.log(`  PASS  ${m}`);
if (!QUIET) for (const m of warn) console.log(`  WARN  ${m}`);
if (!QUIET) for (const m of gaps) console.log(`  GAP   ${m}`);
console.log(bar);
if (fail.length) {
  for (const m of fail) console.log(`  FAIL  ${m}`);
  console.log(
    `\n结果：${pass.length} PASS / ${fail.length} FAIL / ${warn.length} WARN / ${gaps.length} 装置缺口 —— 安装契约未通过`
  );
  process.exit(1);
}
console.log(
  `\n结果：${pass.length} PASS / 0 FAIL / ${warn.length} WARN / ${gaps.length} 装置缺口 —— 安装契约 ALL GREEN`
);

/** 与 exists() 区分：用于临时目录里的绝对路径 */
function exists2(p) {
  return fs.existsSync(p);
}

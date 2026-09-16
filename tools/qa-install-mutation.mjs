#!/usr/bin/env node
/**
 * qa-install-mutation.mjs — 对 qa-install.mjs 的变异测试
 *
 * 通则（references/lessons.md #33）：**没有变异测试的校验器，它的「全绿」不算证据。**
 * 本文件搭一个自包含的「假安装包」仓库（真探针 + 真 bridge + 真清单 + 真文档），
 * 逐项注入已知缺陷，断言 qa-install 确实会报、且报对地方；再断言未变异时干净（防过校正）。
 *
 * 为什么必须搭夹具而不是就地在真仓库上变异：真仓库是交付物，不能为了测测试去改它。
 *
 * 用法：node tools/qa-install-mutation.mjs
 * 零依赖；退出码 0 = 全部例通过。行为类用例会起 bridge（临时端口），故耗时约 30s。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-install-mut-"));
const BASE = path.join(TMP, "base");

/* ---------------- 夹具：一个最小但完整的「安装包」 ---------------- */

const COPY_FILES = [
  "VERSION",
  ".gitignore",
  "README.md",
  "README_EN.md",
  "SETUP.md",
  "USER_GUIDE.md",
  "SKILL.md",
  "CHANGELOG.md",
  "references/runtime-capability.md",
  "references/bridge-ops.md",
  "tools/runtime-check.mjs",
  "tools/qa-plugin.mjs",
  "tools/qa-install.mjs", // 被测对象也随包复制，这样夹具自包含、变异只作用在夹具上
  "bridge/server.js",
  "figma-plugin/manifest.json",
  "figma-plugin/code.js",
  "figma-plugin/ui.html",
];

function seedBase() {
  for (const rel of COPY_FILES) {
    const dst = path.join(BASE, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  // qa-plugin.mjs 只需存在（QA1 存在性检查用），不必是真身
  fs.writeFileSync(path.join(BASE, "tools", "qa-plugin.mjs"), "// fixture placeholder\n");
}

function freshFixture() {
  const dir = fs.mkdtempSync(path.join(TMP, "case-"));
  fs.cpSync(BASE, dir, { recursive: true });
  return dir;
}

/* ---------------- 断言工具 ---------------- */

const results = [];
function check(ok, name) {
  results.push({ ok: !!ok, name });
}

const readF = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const writeF = (dir, rel, txt) => fs.writeFileSync(path.join(dir, rel), txt);
/** 替换全部出现处。目标串可能在一份文件里出现多次（如探针里两处 "mcp.json"），
 *  只换第一处的话变异是「无效变异」——测试会因为「变异根本没生效」而假红/假绿。 */
function patch(dir, rel, find, replace) {
  const p = path.join(dir, rel);
  const src = fs.readFileSync(p, "utf8");
  if (!src.includes(find)) throw new Error(`patch 目标不存在：${rel} :: ${String(find).slice(0, 60)}`);
  fs.writeFileSync(p, src.split(find).join(replace));
}

function run(dir, args = []) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(dir, "tools", "qa-install.mjs"), ...args], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

/**
 * 注入一个缺陷、跑一遍、断言「确实失败」且「失败信息命中预期关键词」。
 * 关键词是必须的：只断言 exit!=0 的话，任何 unrelated 崩掉都能让测试变绿。
 */
async function expectCase(name, mutate, keyword, args = ["--no-behavior"]) {
  const dir = freshFixture();
  mutate(dir);
  const r = await run(dir, args);
  const hit = r.out.includes(keyword);
  check(r.code === 1, `${name} → 非零退出（实际 ${r.code}）`);
  check(hit, `${name} → 报出预期问题（关键词「${keyword}」）`);
  if (!hit) {
    // 诊断只取 FAIL 行本身：不能拿 includes("FAIL") 过滤——汇总行里的「0 FAIL」也含 FAIL 字样
    const fails = (r.out || "").split("\n").filter((l) => /^\s*FAIL\s/m.test(l));
    console.log(`\n  [诊断] ${name}\n${fails.join("\n") || r.out.slice(0, 600)}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ================= 0. 基线：未变异必须干净 ================= */

seedBase();

{
  const dir = freshFixture();
  const r = await run(dir, ["--no-behavior"]);
  check(r.code === 0, `基线（未变异，--no-behavior）→ exit 0（实际 ${r.code}）`);
  check(/0 FAIL/.test(r.out), "基线（未变异）→ 0 FAIL");
  // 逐条 FAIL 行不得出现（不能拿 includes("FAIL") 判——汇总行里的「0 FAIL」也含 FAIL 字样）
  check(!/^\s*FAIL\s/m.test(r.out), "基线（未变异）→ 无任何 FAIL 行（防过校正：什么都报）");
  const n = Number((r.out.match(/(\d+) PASS/) || [])[1]);
  check(n >= 25, `基线（--no-behavior）断言数 ≥25（实际 ${n}，防「只跑了一部分」被当全绿）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // 行为段也必须基线干净（真起 bridge）
  const dir = freshFixture();
  const r = await run(dir, []);
  check(r.code === 0, `基线（未变异，含行为段）→ exit 0（实际 ${r.code}）`);
  const n = Number((r.out.match(/(\d+) PASS/) || [])[1]);
  check(n >= 90, `基线（含行为段）断言数 ≥90（实际 ${n}）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ================= 1. QA1 交付物存在 ================= */

await expectCase("删掉 SETUP.md", (d) => fs.unlinkSync(path.join(d, "SETUP.md")), "安装入口交付物齐备");
await expectCase("删掉探针", (d) => fs.unlinkSync(path.join(d, "tools", "runtime-check.mjs")), "安装入口交付物齐备");
await expectCase("删掉 .gitignore", (d) => fs.unlinkSync(path.join(d, ".gitignore")), "安装入口交付物齐备");

/* ================= 2. QA2 探针静态约束 ================= */

await expectCase(
  "探针新增写操作（含 POST）",
  (d) => patch(d, "tools/runtime-check.mjs", "const BRIDGE_URL", 'const EVIL = "POST /v1/command";\nconst BRIDGE_URL'),
  "探针无写操作"
);
await expectCase(
  "探针引入外部依赖",
  (d) => writeF(d, "tools/runtime-check.mjs", 'import got from "got";\n' + readF(d, "tools/runtime-check.mjs")),
  "探针零外部依赖"
);
await expectCase(
  "探针对 /health 带 token 参数",
  (d) => patch(d, "tools/runtime-check.mjs", "`${BRIDGE_URL}/health`", "`${BRIDGE_URL}/health?token=${process.env.T}`"),
  "不带 token"
);
await expectCase(
  "探针自建服务",
  (d) => writeF(d, "tools/runtime-check.mjs", readF(d, "tools/runtime-check.mjs") + "\nconst s = new Server(); s.listen(1);\n"),
  "不创建新协议"
);
await expectCase(
  "探针不再读 MCP 配置",
  (d) => patch(d, "tools/runtime-check.mjs", "mcp.json", "config-renamed.json"),
  "读 MCP 配置"
);
await expectCase(
  "探针漏认 figma-developer-mcp",
  (d) => patch(d, "tools/runtime-check.mjs", '|| haystack.includes("figma-developer-mcp")', ""),
  "都在判定逻辑里认"
);

/* ================= 3. QA6 口径一致 ================= */

await expectCase(
  "文档编造第四种模式",
  (d) => writeF(d, "SETUP.md", readF(d, "SETUP.md") + "\n本技能还有 PARTIAL_MODE 用于半连接场景。\n"),
  "模式枚举锁死"
);
await expectCase(
  "文档把 READ_ONLY 提示写错一个字",
  (d) => patch(d, "SKILL.md", "需要安装 Figma Bridge 才能自动绘制", "需要安装 Figma Bridge 才可以自动绘制"),
  "READ_ONLY 提示与探针实跑逐字一致"
);
await expectCase(
  "canonical 文档把 OFFLINE 提示截短",
  (d) =>
    patch(
      d,
      "references/runtime-capability.md",
      "未检测到 Figma 连接能力，仅可生成设计资产（Brief / DS Spec / Build Plan）",
      "未检测到 Figma 连接能力，仅可生成设计资产"
    ),
  "OFFLINE 提示与探针实跑逐字一致"
);
await expectCase(
  "删掉 README 里「FULL_MODE 下 figmaRead 同为 true」的说明",
  (d) => {
    const t = readF(d, "README.md")
      .split("\n")
      .filter((l) => !/(figmaRead|读能力不只来自 MCP)/.test(l))
      .join("\n");
    writeF(d, "README.md", t);
  },
  "FULL_MODE 下 figmaRead 同为 true"
);
await expectCase(
  "删掉 USER_GUIDE 对 READ_ONLY 提示的引用（覆盖度跌破下限）",
  (d) => {
    const t = readF(d, "USER_GUIDE.md").split("当前环境只有读取能力，需要安装 Figma Bridge 才能自动绘制").join("（见探针输出）");
    writeF(d, "USER_GUIDE.md", t);
  },
  "引用 READ_ONLY 提示的文档数"
);

/* ================= 4. QA3 三模式端到端（行为） ================= */

await expectCase(
  "探针谎报永远 FULL_MODE",
  (d) => patch(d, "tools/runtime-check.mjs", 'const mode = figmaWrite ? "FULL_MODE" : figmaRead ? "READ_ONLY_MODE" : "OFFLINE_MODE";', 'const mode = "FULL_MODE";'),
  "mode 与能力组合自洽",
  []
);
await expectCase(
  "探针 executor 与 figmaWrite 不自洽",
  (d) => patch(d, "tools/runtime-check.mjs", 'executor: figmaWrite ? "figma-plugin-bridge" : null,', 'executor: "figma-plugin-bridge",'),
  "executor 与 figmaWrite 自洽",
  []
);
await expectCase(
  "探针把 bridge 可达但插件未连也算作写能力",
  (d) => patch(d, "tools/runtime-check.mjs", "const figmaWrite = bridgeRead;", "const figmaWrite = bridge.reachable;"),
  "bridge 可达但 plugin.connected=false",
  []
);
await expectCase(
  "探针漏掉 disabled 的 MCP 仍计读能力",
  (d) => patch(d, "tools/runtime-check.mjs", "if (srv?.disabled === true) continue;", ""),
  "disabled 的 Figma MCP 不计入读能力",
  []
);
await expectCase(
  "探针 version 与 VERSION 文件脱节",
  (d) => patch(d, "tools/runtime-check.mjs", 'return fs.readFileSync(fileURLToPath(new URL("../VERSION", import.meta.url)), "utf8").trim() || null;', 'return "9.9.9";'),
  "version 与 VERSION 文件一致",
  []
);

/* ================= 5. QA4 / QA5 行为承诺 ================= */

await expectCase(
  "探针 --no-write 也落盘（谎报只读）",
  (d) => patch(d, "tools/runtime-check.mjs", "if (!noWrite) {", "if (true) {"),
  "不落盘",
  []
);
await expectCase(
  "探针把产物落到 cwd 而非技能目录（破坏 cwd 无关性）",
  (d) =>
    patch(
      d,
      "tools/runtime-check.mjs",
      'fileURLToPath(new URL("../.vibe/runtime-capability.json", import.meta.url))',
      'path.resolve(process.cwd(), ".vibe/runtime-capability.json")'
    ),
  "仍写技能目录",
  []
);

/* ================= 6. QA7 安装合约事实 ================= */

await expectCase(
  "插件清单端口与 bridge 不一致",
  (d) => patch(d, "figma-plugin/manifest.json", "localhost:45677", "localhost:45678"),
  "端口四处一致",
  ["--no-behavior"]
);
await expectCase(
  "插件界面端口与 bridge 不一致",
  (d) => patch(d, "figma-plugin/ui.html", 'CANDIDATE_BASES = ["http://localhost:45677"]', 'CANDIDATE_BASES = ["http://localhost:45678"]'),
  "端口四处一致"
);
await expectCase(
  "插件清单改用 127.0.0.1 拼写",
  (d) => patch(d, "figma-plugin/manifest.json", "http://localhost:45677", "http://127.0.0.1:45677"),
  "只用 localhost 拼写"
);
await expectCase(
  "bridge 不再绑 ::1（localhost 解析到 ::1 时插件连不上）",
  (d) => patch(d, "bridge/server.js", 'const LOOPBACK_V6 = "::1";', "const LOOPBACK_V6 = null;"),
  "同时绑 ::1"
);
await expectCase(
  "bridge 绑到 0.0.0.0（对外网开放）",
  (d) => patch(d, "bridge/server.js", 'const HOST = "127.0.0.1";', 'const HOST = "0.0.0.0";'),
  "只绑回环地址"
);
await expectCase(
  ".gitignore 不再忽略 .vibe/（token 会被提交）",
  (d) => writeF(d, ".gitignore", readF(d, ".gitignore").replace(".vibe/", "")),
  "忽略 .vibe/"
);
await expectCase(
  "文档把 token 位置说成「运行目录」（暗示跟 cwd 走）",
  (d) => patch(d, "SETUP.md", "存放在**仓库目录**下自动生成的", "存放在运行目录下自动生成的"),
  "绑定到仓库目录而非 cwd"
);
await expectCase(
  "manifest.main 指向不存在的文件",
  (d) => patch(d, "figma-plugin/manifest.json", '"main": "code.js"', '"main": "missing.js"'),
  "manifest.main 指向存在的 code.js"
);
await expectCase(
  "插件名与 SETUP 里让用户选的名字不一致",
  (d) => patch(d, "figma-plugin/manifest.json", "agent-design-figma Bridge (Dev)", "some-other-plugin"),
  "插件名与 manifest.name 一致"
);

/* ================= 7. QA8 SKILL.md 注册 ================= */

await expectCase(
  "SKILL.md 不再注册探针入口",
  (d) => writeF(d, "SKILL.md", readF(d, "SKILL.md").replace(/runtime-check/g, "runtime-probe")),
  "注册 runtime-check"
);
await expectCase(
  "SKILL.md 删掉降级铁律",
  (d) => patch(d, "SKILL.md", "不得假装跑过", "应当尽量真实"),
  "诚实铁律"
);

/* ================= 8. 一次报全部 / 降级 / 静默 ================= */

{
  const dir = freshFixture();
  patch(dir, "figma-plugin/manifest.json", "localhost:45677", "localhost:45678");
  patch(dir, "bridge/server.js", 'const LOOPBACK_V6 = "::1";', "const LOOPBACK_V6 = null;");
  writeF(dir, "SKILL.md", readF(dir, "SKILL.md").replace(/runtime-check/g, "runtime-probe"));
  fs.unlinkSync(path.join(dir, "SETUP.md"));
  const r = await run(dir, ["--no-behavior"]);
  const fails = r.out.split("\n").filter((l) => l.trim().startsWith("FAIL"));
  check(fails.length >= 4, `一次报全部：多个缺陷同现时全部报出（实际 ${fails.length} 条 FAIL，非 fail-fast）`);
  check(
    fails.some((l) => l.includes("安装入口交付物")) && fails.some((l) => l.includes("端口四处一致")),
    "一次报全部：跨组缺陷（QA1 + QA7）都报出"
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = freshFixture();
  const r = await run(dir, ["--quiet"]);
  check(r.code === 0, `--quiet 仍 exit 0（实际 ${r.code}）`);
  check(/结果：\d+ PASS/.test(r.out), "--quiet 仍出汇总行");
  check(!/^  PASS/m.test(r.out), "--quiet 不出逐条 PASS");
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = freshFixture();
  const r = await run(dir, ["--no-behavior"]);
  check(/装置缺口/.test(r.out), "--no-behavior 在汇总里显式标注装置缺口（不把「没跑」说成「跑过了」）");
  check(/^  GAP/m.test(r.out), "--no-behavior 逐条列出被跳过的行为检查");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ================= 9. 豁免/软档不得空转 ================= */

{
  const dir = freshFixture();
  const r = await run(dir, ["--no-behavior"]);
  // 软档命中数非零断言：QA9 与 QA7 的「跳过运行时校验」必须至少命中一种，
  // 否则无法区分「确实没有该情况」与「软规则从未生效」。
  const warned = (r.out.match(/^  WARN/m) || []).length;
  check(warned >= 1, `软档（WARN）至少命中 1 条，证明软规则是活的（实际 ${warned}）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ================= 汇总 ================= */

fs.rmSync(TMP, { recursive: true, force: true });

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
for (const r of results) if (!r.ok) console.log(`  FAIL  ${r.name}`);
console.log(`\n${passed} PASS / ${failed} FAIL —— qa-install 变异测试${failed ? "未通过" : " ALL GREEN"}`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * anchor-compare 的变异测试 —— 给校验器造错，看它抓不抓得住。
 *
 * 覆盖（每条都配「应抓错 / 应放过」两侧）：
 *   出处  J1 --source 缺失 / 非 http(s) ｜ J2 --license 缺失 ⇒ exit≠0 且不出报告正文
 *   锚点  J3 空 md / 只有 1 色 ⇒ exit 1（空锚点比对 = 假证据）
 *   画布  J4 全无 fills+fontName ⇒ exit 1（结构性无法比对，不许空报告装绿）
 *   解析  字族签名（第 3 列 px）：阴影表 / 断点表**不得**混进字族；字阶表必须收进
 *   计算  rgbDist 已知值单测 · colorDelta 最近色与 exact 标记 · 均距/最大距口径
 *   报告  provenance 四件套（source/license/sha256/fetchedAt）齐全 · sha256 对同内容稳定
 *   反向  判据全过时 exit=0（抓错抓得对不等于放行放得对）
 *
 * 用法：node tools/anchor-compare-mutation.mjs  零依赖；exit 0 = 全过。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "tools", "anchor-compare.mjs");
const FX = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-mut-"));

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") };
  }
};

/* ---------------- 夹具 ---------------- */

const ANCHOR_MD = `# Design System Inspired by Fixture

## 2. Color Palette & Roles

### Primary
- **Fixture Blue** (\`#3366ff\`): Primary brand color.
- **Ink** (\`#111111\`): Heading color.
- **Paper** (\`#fff\`): Page background.
- **Faint** (\`#eeeeee\`): Disabled.

## 3. Typography Rules

### Font Family
- **Primary**: \`Fixture Sans\`, with fallbacks: system-ui
- **Monospace**: \`Fixture Mono\`

### Hierarchy

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| Display | Fixture Sans | 48px (3rem) | 400 | hero |
| Body | Fixture Sans | 16px (1rem) | 400 | reading |
| Caption | Fixture Sans | 12px (0.75rem) | 400 | meta |

## 4. Component Stylings

### Shadows
| Elevation | Shadow | Notes |
|-----------|--------|-------|
| Card | \`rgba(0,0,0,0.2) 0px 2px 4px\` | must NOT become a family |

### Breakpoints
| Name | Range | Notes |
|------|-------|-------|
| MD | 640–768px | must NOT become a family |
`;

const readbackOf = (nodes) => ({ data: { nodes: [{ type: "FRAME", name: "R", width: 100, height: 100, children: nodes }] } });

const node = (over = {}) => ({
  type: "TEXT",
  name: "t",
  width: 40,
  height: 20,
  fills: ["#3366ff"],
  fontName: { family: "Fixture Sans", style: "Regular" },
  fontSize: 16,
  ...over,
});

const writeFile = (name, content) => {
  const p = path.join(FX, name);
  fs.writeFileSync(p, content);
  return p;
};

const anchorPath = writeFile("anchor.DESIGN.md", ANCHOR_MD);
const goodReadback = writeFile(
  "good.json",
  JSON.stringify(readbackOf([node(), node({ fills: ["#111111"] }), node({ fills: ["#ff0000"] })])),
);
const SRC = "https://example.com/design-systems/fixture/DESIGN.md";

const base = (rb, extra = []) => [rb, "--anchor", anchorPath, "--source", SRC, "--license", "Apache-2.0", ...extra];
/** 显式换锚点：--anchor 放在**最后**且工具 arg() 取首个出现 —— 故此处不能再用 base()（会带出好锚点）。 */
const withAnchor = (rb, anchor, extra = []) => [rb, "--source", SRC, "--license", "Apache-2.0", "--anchor", anchor, ...extra];
const json = (out) => {
  const i = out.indexOf("{");
  return i >= 0 ? JSON.parse(out.slice(i)) : null;
};

try {
  /* ---------------- 计算：纯函数单测（import 语义用子进程太重，这里复制口径验证） ---------------- */
  {
    const mod = await import(pathToFileURL(path.join(ROOT, "tools", "anchor-compare.mjs")).href).catch(() => null);
    // 工具是 CLI 直跑模式（顶层有 process.exit 风险的副作用），纯函数仍导出了；import 失败则跳过不算 PASS
    if (mod && mod.rgbDist && mod.parseAnchor && mod.colorDelta && mod.parseCanvas) {
      const { rgbDist, parseAnchor, colorDelta, parseCanvas } = mod;
      check(rgbDist("#000000", "#000000") === 0, "纯 rgbDist 同色距 0");
      check(rgbDist("#ffffff", "#000000") === 441.7, `纯 rgbDist 黑白距 441.7（实际 ${rgbDist("#ffffff", "#000000")}）`);
      check(rgbDist("#3366ff", "#3366ff") === 0, "纯 rgbDist 已知同色");

      const a = parseAnchor(ANCHOR_MD);
      check(a.colors.length === 4, `锚点解析 4 色（#fff 三位应扩展；实际 ${a.colors.length}`);

      const fams = a.families.join("|");
      check(a.families.includes("Fixture Sans") && a.families.includes("Fixture Mono"), "字阶表 + Primary/Monospace 收进字族");
      check(!/rgba|0px|640/.test(fams), `阴影表 / 断点表不得混进字族（实际 ${fams}）`);
      check(a.sizes.includes(48) && a.sizes.includes(16) && a.sizes.includes(12), `字阶尺寸收全（实际 ${a.sizes}）`);

      const cd = colorDelta(
        [{ value: "#3366ff", count: 2 }, { value: "#ff0000", count: 1 }],
        a.colors,
      );
      check(cd[0].exact === true, "板内色 exact=true");
      check(cd[0].nearest.hex === "#3366ff" && cd[0].nearest.distance === 0, "板内色最近=自身距 0");
      check(cd[1].exact === false && cd[1].nearest.distance > 0, "板外色 exact=false 距>0");
      check(cd[1].nearest.hex === "#111111", `红的最近是 Ink #111111（实测算出；实际 ${cd[1].nearest.hex}）`);

      const canvas = parseCanvas(
        Object.assign(node(), { children: [node({ strokes: ["#eeeeee"] }), node({ fontSize: 12 })] }),
      );
      check(canvas.colors.some((c) => c.value === "#eeeeee" && c.count === 1), "strokes 也算画布色");
      check(canvas.families[0].value === "Fixture Sans", "画布字族解析");
      check(canvas.sizes.some((s) => s.value === 12), "画布字号解析");
    } else {
      fail.push("纯函数未能 import（anchor-compare.mjs 需保持可导出 parseAnchor/parseCanvas/colorDelta/rgbDist）");
    }
  }

  /* ---------------- 应抓错 ---------------- */
  {
    const r = run([goodReadback, "--anchor", anchorPath, "--license", "Apache-2.0"]);
    check(r.status === 1, `J1 缺 --source ⇒ exit 1（实际 ${r.status}）`);
    check(/J1/.test(r.out), "J1 信息点名出处判据");
  }
  {
    const r = run([goodReadback, "--anchor", anchorPath, "--source", "not-a-url", "--license", "Apache-2.0"]);
    check(r.status === 1, `J1 非 http(s) ⇒ exit 1（实际 ${r.status}）`);
  }
  {
    const r = run([goodReadback, "--anchor", anchorPath, "--source", SRC]);
    check(r.status === 1, `J2 缺 --license ⇒ exit 1（实际 ${r.status}）`);
  }
  {
    const p = writeFile("empty.md", "# empty\n\n没有 token 的文件\n");
    const r = run(withAnchor(goodReadback, p));
    check(r.status === 1, `J3 空锚点 ⇒ exit 1（实际 ${r.status}）`);
    check(/J3/.test(r.out), "J3 信息点名「提取失败 ≠ 锚点很素」");
  }
  {
    const p = writeFile("one.md", "# one\n\n- **Only** (`#123456`): single color.\n");
    const r = run(withAnchor(goodReadback, p));
    check(r.status === 1, `J3 单色锚点 ⇒ exit 1（实际 ${r.status}）`);
  }
  {
    const rb = writeFile("nocolor.json", JSON.stringify(readbackOf([{ type: "TEXT", name: "t", width: 10, height: 10, fontName: { family: "X", style: "R" }, fontSize: 12 }])));
    const r = run(base(rb));
    check(r.status === 1, `J4 画布无色 ⇒ exit 1（实际 ${r.status}）`);
    check(/J4/.test(r.out), "J4 信息点名「不许空报告装绿」");
  }
  {
    const rb = writeFile("nofam.json", JSON.stringify(readbackOf([{ type: "RECTANGLE", name: "r", width: 10, height: 10, fills: ["#3366ff"] }])));
    const r = run(base(rb));
    check(r.status === 1, `J4 画布无字族 ⇒ exit 1（实际 ${r.status}）`);
  }
  {
    const r = run([goodReadback, "--anchor", path.join(FX, "missing.md"), "--source", SRC, "--license", "X"]);
    check(r.status === 2, `锚点文件不存在 ⇒ exit 2 用法错（实际 ${r.status}）`);
  }

  /* ---------------- 应放过 + 报告内容 ---------------- */
  {
    const r = run([...base(goodReadback), "--json"]);
    check(r.status === 0, `判据全过 ⇒ exit 0（实际 ${r.status}）\n${r.out}`);
    const rep = json(r.out);
    check(!!rep, "--json 输出报告");
    check(rep.provenance.source === SRC, "报告 provenance.source 回放可得");
    check(rep.provenance.license === "Apache-2.0", "报告 provenance.license 回放可得");
    check(/^[0-9a-f]{64}$/.test(rep.provenance.snapshotSha256), "报告含完整 sha256（J5 回放四件套之三）");
    check(/^\d{4}-\d{2}-\d{2}/.test(rep.provenance.fetchedAt), "报告含 fetchedAt（J5 回放四件套之四）");
    check(rep.anchor.colorCount >= 3 && rep.anchor.families.length >= 1, "报告锚点侧 token 齐全");
    check(rep.canvas.nodeTotal >= 2, "报告画布侧节点计数");
    check(rep.canvas.colors.length === 3, `画布 3 色全收（实际 ${rep.canvas.colors.length}）`);
    check(rep.colorDelta.exactCount === 2, "2 色精确命中（#3366ff 与 #111111 都在锚点板内）");
    check(rep.colorDelta.exactHexes.includes("#3366ff") && rep.colorDelta.exactHexes.includes("#111111"), "精确命中的具体色");
    check(rep.colorDelta.offPaletteCount === 1, "1 色板外（#ff0000）");
    check(rep.colorDelta.maxDistance > 0 && rep.colorDelta.meanDistance > 0, "板外距的 max/mean 口径 >0");
    check(/非相似度评分|不是相似度/.test(rep._meta.note), "报告 _meta 声明「机械证据，非相似度评分」（H3 防线）");
  }
  {
    // --out 落盘 + sha256 稳定性
    const outP = path.join(FX, "rep.json");
    run(base(goodReadback, ["--out", outP]));
    const rep1 = JSON.parse(fs.readFileSync(outP, "utf8"));
    const r2 = run([...base(goodReadback), "--json"]);
    const rep2 = json(r2.out);
    check(rep1.provenance.snapshotSha256 === rep2.provenance.snapshotSha256, "同内容快照 sha256 稳定（可回放的根基）");
    check(!!rep1.canvas && !!rep2.canvas, "--out 与 stdout 报告同构");
  }
  {
    // --json 模式判据失败也要走 JSON
    const r = run([goodReadback, "--anchor", anchorPath, "--license", "X", "--json"]);
    check(r.status === 1, `--json 下判据失败仍 exit 1（实际 ${r.status}）`);
    const rep = json(r.out);
    check(rep && rep.ok === false && /J1/.test(rep.errors.join()), "--json 失败输出 errors 结构");
  }
} finally {
  fs.rmSync(FX, { recursive: true, force: true });
}

/* ---------------- 汇总 ---------------- */

console.log(`anchor-compare-mutation：${pass.length} PASS / ${fail.length} FAIL`);
for (const f of fail) console.log(`  ✗ ${f}`);
process.exit(fail.length ? 1 : 0);

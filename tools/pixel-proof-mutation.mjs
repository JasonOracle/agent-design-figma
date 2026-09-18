#!/usr/bin/env node
/**
 * pixel-proof-mutation.mjs — 对 pixel-proof.mjs 的变异测试
 *
 * 为什么需要它：pixel-proof 是 **1.3 · C1 从 `.vibe/` 临时装置收编** 来的（lessons #56/#57/#59）。
 * 收编的判据（lessons #73）不是「搬进 tools/ 就算数」，而是**代码 + 前提 + 留痕 + 变异测试**。
 * 一个 PNG 解码器最危险的失败模式是**悄悄解错**：直方图照样打印、exit 照样 0，
 * 但颜色统计全是垃圾 —— 那么它给出的「玻璃感存在」结论就是假的。
 *
 * 所以本测试分三组，**用自己造的 PNG 反查解码正确性**（不读仓库任何真实截图，
 * 因为真实截图的「正确答案」本身就要靠这个工具算，拿它当基准是循环论证）：
 *
 *   A. 用法/输入错误 → 必须退出 2 且给出可读原因（含「选项取值不合法不静默回落」）
 *   B. 解码正确性   → 自造各 colorType（0/2/3/4/6）与全部 5 种 filter 字节的 PNG，
 *                     断言还原出的颜色统计**恰好**等于造图时写入的值
 *   C. 统计/断言语义 → --expect-diff / --expect-same / --expect-content / --region /
 *                     --grid / --top 的边界，以及 --json 的结构
 *
 * 用法：node tools/pixel-proof-mutation.mjs
 * 零依赖（node 内置 zlib；PNG 编码器在本文件内自实现，约 40 行）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "tools", "pixel-proof.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-proof-mut-"));

/* ---------------- 极简 PNG 编码器（只为造夹具） ---------------- */

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};

/**
 * 造 PNG。`rows` 是**已含 filter 字节**的扫描行数组。
 * `rawOverride` 用于故意造坏数据（行数不足 / 非法 filter 字节）。
 */
function png({ width, height, colorType = 2, bitDepth = 8, interlace = 0, plte = null, trns = null, rows }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = interlace;
  const parts = [SIG, chunk("IHDR", ihdr)];
  if (plte) parts.push(chunk("PLTE", plte));
  if (trns) parts.push(chunk("tRNS", trns));
  parts.push(chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** 把 n 个通道向量拼成一行像素字节。 */
const rep = (n, px) => {
  const a = [];
  for (let i = 0; i < n; i++) a.push(...px);
  return a;
};
/** filter type 0 的行。 */
const f0 = (px) => Buffer.concat([Buffer.from([0]), Buffer.from(px)]);
/** 按 PNG 规范对一行做正向滤波（用于造 filter 1–4 的行）。 */
const filterRow = (type, cur, prev, ch) => {
  const out = Buffer.alloc(cur.length);
  for (let x = 0; x < cur.length; x++) {
    const a = x >= ch ? cur[x - ch] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= ch ? prev[x - ch] : 0;
    let v;
    if (type === 0) v = cur[x];
    else if (type === 1) v = cur[x] - a;
    else if (type === 2) v = cur[x] - b;
    else if (type === 3) v = cur[x] - ((a + b) >> 1);
    else {
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      v = cur[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
    out[x] = v & 0xff;
  }
  return out;
};

/* ---------------- 夹具 ---------------- */

const P = (name, buf) => {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, buf);
  return p;
};

const solidRgb = (w, h, rgb) =>
  png({ width: w, height: h, colorType: 2, rows: Array.from({ length: h }, () => f0(rep(w, rgb))) });

/** 左右两半不同色（w 必须为偶数）—— 用于验证 --region 真的按区域统计。 */
const splitRgb = (w, h, left, right) =>
  png({
    width: w,
    height: h,
    colorType: 2,
    rows: Array.from({ length: h }, () =>
      f0([].concat(...Array.from({ length: w }, (_, x) => (x < w / 2 ? left : right)))),
    ),
  });

/** 5 行分别用 filter 0/1/2/3/4 —— 验证解码器五种滤波路径全部还原正确。 */
const filterZoo = () => {
  const w = 4;
  const ch = 3;
  const colors = [
    [10, 20, 30], // filter 0（同色连两行 → 后一行滤波值全 0，是 Sub/Up 的共性行）→ 共 8px
    [10, 20, 30],
    [200, 100, 50],
    [7, 8, 9],
    [255, 0, 128],
  ];
  const types = [0, 1, 2, 3, 4];
  const rows = [];
  let prev = null;
  colors.forEach((c, i) => {
    const cur = Buffer.from(rep(w, c));
    rows.push(Buffer.concat([Buffer.from([types[i]]), filterRow(types[i], cur, prev, ch)]));
    prev = cur;
  });
  return png({ width: w, height: colors.length, colorType: 2, rows });
};

const grayPng = () =>
  png({ width: 4, height: 2, colorType: 0, rows: [f0(rep(4, [0])), f0(rep(4, [255]))] });

/** 灰度 + alpha：同灰度不同 alpha，应被视作同一颜色（alpha 不参与比对）。 */
const grayAlphaPng = () =>
  png({ width: 4, height: 2, colorType: 4, rows: [f0(rep(4, [0, 255])), f0(rep(4, [0, 10]))] });

/** RGBA：同 RGB、alpha 由 255→0，仍应只有 1 种颜色。 */
const rgbaPng = () =>
  png({ width: 4, height: 2, colorType: 6, rows: [f0(rep(4, [255, 0, 0, 255])), f0(rep(4, [255, 0, 0, 0]))] });

/** 调色板 3 色 + tRNS。 */
const palettePng = (withTrns) => {
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const rows = [
    f0([0, 0, 0, 0]),
    f0([1, 1, 1, 1]),
    f0([2, 2, 2, 2]),
  ];
  return png({ width: 4, height: 3, colorType: 3, plte, trns: withTrns ? Buffer.from([0]) : null, rows });
};

const fixtures = {
  red: P("red.png", solidRgb(8, 4, [255, 0, 0])),
  blue: P("blue.png", solidRgb(8, 4, [0, 0, 255])),
  redAgain: P("red-again.png", solidRgb(8, 4, [255, 0, 0])),
  wide: P("wide.png", solidRgb(16, 4, [255, 0, 0])),
  split: P("split.png", splitRgb(8, 4, [255, 0, 0], [0, 0, 255])),
  zoo: P("filter-zoo.png", filterZoo()),
  gray: P("gray.png", grayPng()),
  grayAlpha: P("gray-alpha.png", grayAlphaPng()),
  rgba: P("rgba.png", rgbaPng()),
  palette: P("palette.png", palettePng(false)),
  paletteTrns: P("palette-trns.png", palettePng(true)),
  // 坏件
  notPng: P("not.png", Buffer.from("这不是 PNG，只是一段文本\n")),
  bit16: P("bit16.png", png({ width: 2, height: 2, colorType: 2, bitDepth: 16, rows: [f0([0, 0, 0, 0, 0, 0])] })),
  interlaced: P("interlaced.png", png({ width: 2, height: 2, colorType: 2, interlace: 1, rows: [f0(rep(2, [1, 2, 3]))] })),
  badColorType: P("colortype7.png", png({ width: 2, height: 2, colorType: 7, rows: [f0(rep(2, [1, 2, 3]))] })),
  noPlte: P("no-plte.png", png({ width: 2, height: 2, colorType: 3, rows: [f0([0, 0])] })),
  shortRows: P("short.png", png({ width: 4, height: 5, colorType: 2, rows: [f0(rep(4, [1, 2, 3])), f0(rep(4, [4, 5, 6]))] })),
  badFilter: P("bad-filter.png", png({ width: 4, height: 1, colorType: 2, rows: [Buffer.concat([Buffer.from([5]), Buffer.from(rep(4, [1, 2, 3]))])] })),
};

/* ---------------- 运行器 ---------------- */

const run = (...args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", timeout: 30000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "" };
};
const runJson = (...args) => {
  const r = run(...args, "--json");
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* 留给断言判空 */
  }
  return { ...r, json };
};

let pass = 0;
let fail = 0;
const ok = (label) => {
  console.log(`  ok   ${label}`);
  pass++;
};
const miss = (label, detail) => {
  console.log(`  MISS ${label}${detail ? ` → ${detail}` : ""}`);
  fail++;
};

/** 断言退出码（可附带必须在输出里出现的关键词）。 */
const expectCode = (label, args, wantCode, keyword) => {
  const { code, out } = run(...args);
  if (code !== wantCode) return miss(label, `exit=${code}，期望 ${wantCode}`);
  if (keyword && !out.includes(keyword)) return miss(label, `exit=${wantCode} 但输出缺「${keyword}」`);
  ok(label);
};
/** 断言任意条件。 */
const expect = (label, cond, detail) => (cond ? ok(label) : miss(label, detail));

/* ---------------- A. 用法 / 输入错误（必须 exit 2，且不静默降级） ---------------- */

console.log("── A. 用法/输入错误 ──");
expectCode("无位置参数 → 退出 2", [], 2, "用法");
expectCode("三个位置参数 → 退出 2", [fixtures.red, fixtures.blue, fixtures.split], 2, "用法");
expectCode("文件不存在 → 退出 2", [path.join(TMP, "nope.png")], 2, "读不到文件");
expectCode("非 PNG → 退出 2", [fixtures.notPng], 2, "不是 PNG");
expectCode("16 位 PNG → 退出 2", [fixtures.bit16], 2, "只支持 8 位");
expectCode("隔行 PNG → 退出 2", [fixtures.interlaced], 2, "不支持隔行");
expectCode("非法 colorType → 退出 2", [fixtures.badColorType], 2, "不支持的 colorType");
expectCode("调色板缺 PLTE → 退出 2", [fixtures.noPlte], 2, "缺 PLTE");
expectCode("IDAT 行数不足 → 退出 2", [fixtures.shortRows], 2, "IDAT 数据不足");
expectCode("非法 filter 字节 → 退出 2", [fixtures.badFilter], 2, "未知 filter type");
expectCode("--region 越界 → 退出 2", [fixtures.red, "--region", "0,0,99,99"], 2, "越出图像");
expectCode("--region 格式错 → 退出 2", [fixtures.red, "--region", "abc"], 2, "x,y,w,h");
expectCode("--region 给了没值 → 退出 2（不静默按整图）", [fixtures.red, "--region"], 2, "没给值");
expectCode("--grid 非数字 → 退出 2（不静默变空网格）", [fixtures.red, "--grid", "abc"], 2, "--grid 需要一个数字");
expectCode("--top 非数字 → 退出 2", [fixtures.red, "--top", "abc"], 2, "--top 需要一个数字");
expectCode("--expect-content 阈值非数字 → 退出 2", [fixtures.split, "--expect-content", "abc"], 2, "需要是数字");
expectCode("两图尺寸不同 → 退出 2（不裁剪不缩放）", [fixtures.red, fixtures.wide], 2, "拒绝比对");

/* ---------------- B. 解码正确性（自造 PNG 反查） ---------------- */

console.log("── B. 解码正确性 ──");
{
  const { json } = runJson(fixtures.red);
  expect(
    "colorType 2 纯色：1 色 / 底色 #ff0000 / 非底色 0",
    json && json.a.distinctColors === 1 && json.a.bg === "#ff0000" && json.a.nonBgRatio === 0,
    json ? `distinct=${json.a.distinctColors} bg=${json.a.bg} nonBg=${json.a.nonBgRatio}` : "无 JSON",
  );
}
{
  const { json } = runJson(fixtures.gray);
  expect("colorType 0 灰度：2 色（0 与 255）", json && json.a.distinctColors === 2, json && `distinct=${json.a.distinctColors}`);
}
{
  const { json } = runJson(fixtures.grayAlpha);
  expect(
    "colorType 4 灰度+alpha：alpha 不参与（仍 1 色）",
    json && json.a.distinctColors === 1,
    json && `distinct=${json.a.distinctColors}（alpha 被计入即为解码错误）`,
  );
}
{
  const { json } = runJson(fixtures.rgba);
  expect(
    "colorType 6 RGBA：alpha 255→0 仍 1 色（只比 RGB）",
    json && json.a.distinctColors === 1,
    json && `distinct=${json.a.distinctColors}`,
  );
}
{
  const { json } = runJson(fixtures.palette);
  const topHex = json && json.a.top.map((t) => t.hex);
  expect(
    "colorType 3 调色板：展开为 3 色且色值来自 PLTE",
    json && json.a.distinctColors === 3 && topHex.includes("#ff0000") && topHex.includes("#00ff00") && topHex.includes("#0000ff"),
    topHex && `top=${topHex.join(",")}`,
  );
}
{
  const { json } = runJson(fixtures.paletteTrns);
  expect("调色板含 tRNS 时如实标注（hasTrns=true）", json && json.images[0].hasTrns === true, json && `hasTrns=${json.images[0].hasTrns}`);
}
{
  const { json } = runJson(fixtures.zoo);
  const topHex = (json && json.a.top.map((t) => t.hex)) || [];
  expect(
    "filter 0–4 五行全解对：4 色且底色 #0a141e 占 8/20（40%）",
    json &&
      json.a.distinctColors === 4 &&
      json.a.bg === "#0a141e" &&
      json.a.bgRatio === 8 / 20 &&
      ["#c86432", "#070809", "#ff0080"].every((h) => topHex.includes(h)),
    json ? `distinct=${json.a.distinctColors} bg=${json.a.bg} ratio=${json.a.bgRatio} top=${topHex.join(",")}` : "无 JSON",
  );
}

/* ---------------- C. 统计 / 断言语义 ---------------- */

console.log("── C. 统计/断言语义 ──");
{
  const { json } = runJson(fixtures.split, "--region", "0,0,4,4");
  expect("--region 左半：只统计 16px、唯一色 #ff0000", json && json.a.pixels === 16 && json.a.distinctColors === 1 && json.a.bg === "#ff0000", json && `pixels=${json.a.pixels} bg=${json.a.bg}`);
}
{
  const { json } = runJson(fixtures.split, "--region", "4,0,4,4");
  expect("--region 右半：底色变为 #0000ff（区域真的生效）", json && json.a.bg === "#0000ff", json && `bg=${json.a.bg}`);
}
{
  const { json } = runJson(fixtures.split);
  expect("半红半蓝：非底色占比恰 0.5（底色取出现最多的，并列取先出现者）", json && json.a.bgRatio === 0.5 && json.a.bg === "#ff0000", json && `bg=${json.a.bg} bgRatio=${json.a.bgRatio}`);
}
{
  const { json } = runJson(fixtures.zoo, "--grid", "1");
  expect("--grid 1 被夹到下限 4（网格 4x4）", json && json._meta.grid === 4 && json.a.cells.length === 4 && json.a.cells[0].length === 4, json && `grid=${json._meta.grid} rows=${json.a.cells.length}`);
}
{
  const { json } = runJson(fixtures.zoo, "--grid", "999");
  expect("--grid 999 被夹到上限 64", json && json._meta.grid === 64 && json.a.cells.length === 64, json && `grid=${json._meta.grid}`);
}
{
  const { json } = runJson(fixtures.zoo, "--top", "1");
  expect("--top 1 只列 1 色（但 distinctColors 仍报全部）", json && json.a.top.length === 1 && json.a.distinctColors === 4, json && `top.length=${json.a.top.length} distinct=${json.a.distinctColors}`);
}
{
  const { out } = run(fixtures.zoo, "--quiet");
  expect("--quiet 不打印密度图与直方图明细", !out.includes("|") && !out.includes("分区非底色密度"), out.includes("|") ? "仍打印了密度图" : undefined);
}
{
  const { out } = run(fixtures.zoo);
  expect("默认打印密度图（含 | 行）与结论行", out.includes("分区非底色密度") && out.includes("结果："), out.includes("|") ? undefined : "未打印密度图");
}
{
  const { code } = run(fixtures.red, "--expect-content");
  expect("纯色图 --expect-content → exit 1（非底色 0 不 > 0）", code === 1, `exit=${code}`);
}
{
  const { out } = run(fixtures.red, "--expect-content");
  expect("--expect-content 落在末尾（无阈值）不崩：输出 PASS/FAIL 行而非 TypeError", !out.includes("TypeError") && out.includes("FAIL  --expect-content"), out.split("\n").find((l) => l.includes("TypeError")) || undefined);
}
{
  const { code, out } = run(fixtures.split, "--expect-content", "0.4");
  expect("半半图 --expect-content 0.4 → exit 0 且报出 50%", code === 0 && /50\.0000%/.test(out), `exit=${code}`);
}
{
  const { code } = run(fixtures.split, "--expect-content", "0.5");
  expect("边界：非底色恰 50% 时 --expect-content 0.5 → exit 1（严格大于）", code === 1, `exit=${code}`);
}
{
  const { code, out } = run(fixtures.red, fixtures.redAgain, "--expect-same");
  expect("同图 --expect-same → exit 0，差异像素 0", code === 0 && /差异像素 0 \/ 32/.test(out), `exit=${code}`);
}
{
  const { code } = run(fixtures.red, fixtures.redAgain, "--expect-diff");
  expect("同图 --expect-diff → exit 1", code === 1, `exit=${code}`);
}
{
  const { code, out } = run(fixtures.red, fixtures.blue, "--expect-diff");
  expect("异图 --expect-diff → exit 0，差异像素 32/32", code === 0 && /差异像素 32 \/ 32/.test(out), `exit=${code}`);
}
{
  const { code } = run(fixtures.red, fixtures.blue, "--expect-same");
  expect("异图 --expect-same → exit 1", code === 1, `exit=${code}`);
}
{
  const { code } = run(fixtures.red, fixtures.redAgain, "--expect-same", "--region", "2,1,4,2");
  expect("A/B 同图 + --region 子区域 + --expect-same → exit 0", code === 0, `exit=${code}`);
}
{
  const { json, stdout } = runJson(fixtures.red, fixtures.blue);
  expect(
    "--json 结构：tool/ok/region/a/b/diff/verdicts 齐备，A/B 尺寸都记录",
    json &&
      json.tool === "pixel-proof" &&
      json.ok === true &&
      Array.isArray(json.region) &&
      json.a &&
      json.b &&
      json.diff &&
      json.images.length === 2 &&
      json.images[0].width === 8,
    json ? `keys=${Object.keys(json).join(",")}` : "无 JSON",
  );
  expect(
    "--json 输出**严格可解析**（无尾随人话行；否则 | jq 与 JSON.parse 全废）",
    stdout.trim().endsWith("}") && !/结果：|PASS  |=====/.test(stdout),
    `尾部：${JSON.stringify(stdout.trim().slice(-40))}`,
  );
  expect("--json 的 cells 压成「每行一个字符串」（不膨胀成上万行）", Array.isArray(json.a.cells) && typeof json.a.cells[0] === "string" && json.a.cells[0].length === json._meta.grid, json && `cells[0]=${JSON.stringify(json.a.cells[0])}`);
}
{
  const { json } = runJson(fixtures.red);
  expect("单图时 --json 的 diff 为 null（无对照即无差异结论）、b 为 null", json && json.diff === null && json.b === null, json && `diff=${JSON.stringify(json.diff)}`);
}
{
  const { json, code } = runJson(fixtures.red, "--expect-content", "0.5");
  expect("--json 也带 verdicts 与 ok=false（断言结果不只活在文本输出里）", json && json.verdicts.length === 1 && json.verdicts[0].ok === false && json.ok === false && code === 1, json && `ok=${json.ok} verdicts=${JSON.stringify(json.verdicts)}`);
}

/* ---------------- 汇总 ---------------- */

console.log("=".repeat(62));
if (fail) {
  console.log(`\n结果：${pass} PASS / ${fail} FAIL —— pixel-proof 变异测试未通过`);
  process.exit(1);
}
console.log(`\n结果：${pass} PASS / 0 FAIL —— pixel-proof 变异测试 ALL GREEN`);

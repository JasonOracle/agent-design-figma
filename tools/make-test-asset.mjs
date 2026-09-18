#!/usr/bin/env node
/**
 * make-test-asset.mjs — 生成 F2（图片填充）的**确定性测试资产**（零依赖，仅 node 内置）。
 *
 * 为什么不直接用 AI 生图：F2 管线验证只关心「合法图片字节 → /v1/asset → UI fetch →
 * figma.createImage → 填充可回读」，图的内容无关紧要；合成 PNG 确定性、零成本、可重复。
 * （用户环境里的 agnes 生图 key 留给真设计场景使用。）
 *
 * 用法：node tools/make-test-asset.mjs [out] [width] [height]
 *   默认 .vibe/assets/test-gradient.png 320x180 —— 8 条横向色带 + 对角渐变，
 *   人眼看得出方向与颜色，方便真机复测时确认 scaleMode 行为（FILL 裁边 / FIT 留白）。
 * 退出码：0 = 成功。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(process.argv[2] || path.join(ROOT, ".vibe", "assets", "test-gradient.png"));
const W = Math.max(1, Number(process.argv[3]) || 320);
const H = Math.max(1, Number(process.argv[4]) || 180);

/* --- 最小 PNG 编码器（真彩色 8bit，无滤波） --- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/* 8 条色带（H 间隔 45°），带对角亮度渐变 —— 便于分辨 FILL/FIT 与翻转 */
const bandHue = (y) => Math.floor((y / H) * 8) * 45;
const hsv = (h, s, v) => {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
};

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const row = y * (1 + W * 3);
  raw[row] = 0; // filter type 0
  for (let x = 0; x < W; x++) {
    const [r, g, b] = hsv(bandHue(y), 0.65, 0.35 + 0.65 * ((x + y) / (W + H)));
    const i = row + 1 + x * 3;
    raw[i] = Math.round(r * 255);
    raw[i + 1] = Math.round(g * 255);
    raw[i + 2] = Math.round(b * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: truecolor
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`asset 已生成：${path.relative(ROOT, out).split(path.sep).join("/")}（${W}x${H}，${png.length} 字节）`);

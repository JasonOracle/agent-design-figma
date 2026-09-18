#!/usr/bin/env node
/**
 * pixel-proof.mjs — 效果类参数的「像素可见性」装置（1.3 · C1 收编）
 *
 * 为什么存在（这是 D2 运行 A 最值钱的一条发现，此前只活在 `.vibe/` 运行目录里）：
 *
 *   lessons #56 —— **承重参数必须有一条能证实它的通道**。运行 A 的毛玻璃全压在一个
 *   `opacity:0.72` 上：`set-effects` 的 `BACKGROUND_BLUR(30)` 能从回读的 `effects` 数组看见，
 *   **但填充透明度看不见** —— `paintToHex()` 只取 `paint.color` 的 RGB，直接丢掉 `paint.opacity`。
 *   于是 `#FFFFFF@100%` 与 `#FFFFFF@72%` 回读出来都是 `["#ffffff"]`：**回读全绿，
 *   而真正要验的那个数根本没进观测面**。结构回读对这类参数是盲的，只有像素能证伪。
 *
 *   lessons #57 —— **效果需要一个可被效果作用的对象**。「模糊一块纯色」的数学结果仍是那块纯色：
 *   `effects=[BACKGROUND_BLUR(30)]` 回读正确、`fills.opacity=0.72` 回读正确、结构项全绿，
 *   但导出图上看不出任何玻璃感。**参数生效了，却没有可观察的后果。**
 *
 *   lessons #59 —— **导出成功 ≠ 有内容**。运行 A 把 10 个节点「移」进一个 `clipsContent:true`
 *   的空帧，回读每一步 `ok:true`、每个节点坐标都合法，导出却是一张 100% 纯色的空白 PNG。
 *
 * 三件事共用一个装置：**把 PNG 的像素统计出来**。所以本工具做三件事：
 *   A. 单图直方图 —— 颜色数 / Top-N 占比 / 底色 / 非底色占比（治 #59「空图」）
 *   B. 分区密度图 —— 20×20 ASCII，看内容**分布**而不是「总量够不够」（治「只在角落有东西」）
 *   C. A/B 对照 —— 两张图（或同图两个区域）的逐像素差异（治 #56 / #57「效果有没有后果」）
 *
 * 能力边界（**必须说清，不可静默降级**）：
 *   · 只解 **8 位、非隔行** 的 PNG（灰度 / RGB / 调色板 / 带 alpha）。16 位或 Adam7 隔行
 *     直接报错退出 2 —— 本装置不打算假装支持它没实现的解码路径。
 *   · 调色板图的 `tRNS`（透明索引）**被忽略**，按不透明处理；报告里会写明这一点。
 *   · A/B 比对要求两图**同尺寸**；不同尺寸直接拒绝，不做裁剪或缩放（那会伪造可比性）。
 *
 * 判据（可复算，不是目测）：
 *   · 差异像素数 / 占比 / 最大与平均通道差 —— 全部由像素直算。
 *   · `--expect-diff` / `--expect-same` / `--expect-content` 把「有差异」「无差异」
 *     「非纯色」变成**退出码**，这样它能当闸门用，而不只是给人看的一段输出。
 *   · **不提供「够不够明显」这类阈值** —— 那是主观判断（撞 H3「零目测评分」）。
 *     本工具只报数字与「是否完全相同」，把「够不够」留给读报告的人。
 *
 * 用法：
 *   node tools/pixel-proof.mjs <a.png> [选项]                      # 单图：直方图 + 密度图
 *   node tools/pixel-proof.mjs <a.png> <b.png> [选项]              # A/B：再加逐像素差异
 *   选项：--region x,y,w,h   只统计/比对该区域（两张图取同一区域）
 *         --grid 20          密度图分辨率（默认 20×20）
 *         --top 12           直方图列出前 N 色（默认 12）
 *         --expect-diff      断言两图**必须不同**（差异像素 = 0 时 exit 1）
 *         --expect-same      断言两图**必须相同**（差异像素 > 0 时 exit 1）
 *         --expect-content [ratio]  断言单图非底色占比 > ratio（缺省 0 = 只要不是纯色）
 *         --quiet            只出结论行（不打印直方图与密度图）
 *         --json             只输出 JSON（含全部统计、判据与 ok 布尔；**不加任何人话行**，可直接 | jq）
 * 退出码：0 结论成立；1 断言不成立；2 用法/输入错误（含不支持的 PNG 形态、选项取值不合法）。
 *   —— 选项取值不合法一律退出 2，**不静默回落默认值**（静默回落会让「参数没生效」看起来像「参数生效了没差别」）。
 * 零依赖（node 内置 zlib 解 PNG）。
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const argv = process.argv.slice(2);
const hasOpt = (name) => argv.indexOf(name) > -1;
/** 取选项值；**选项缺席或位于末尾（无值）都返回 undefined**——调用方必须区分这两种情况。 */
const optOf = (name) => {
  const i = argv.indexOf(name);
  return i > -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
/** 取数值选项；给了但取不到数字 → 退出 2（**不静默回落**，见头部「能力边界」）。 */
const numOpt = (name, dflt) => {
  const raw = optOf(name);
  if (raw === undefined) return dflt === undefined ? undefined : dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`${name} 需要一个数字（收到「${raw}」）`);
    process.exit(2);
  }
  return n;
};
const flag = (name) => argv.includes(name);
const QUIET = flag("--quiet");
const JSON_ONLY = flag("--json");
const GRID = Math.max(4, Math.min(64, numOpt("--grid", 20)));
const TOP = Math.max(1, Math.min(64, numOpt("--top", 12)));

/** 会吃掉后一个 token 的选项——位置参数过滤必须避开它们的取值。 */
const VALUE_OPTS = new Set(["--region", "--grid", "--top", "--expect-content"]);
const positionals = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_OPTS.has(argv[i - 1])));
if (positionals.length < 1 || positionals.length > 2) {
  console.error(
    "用法：node tools/pixel-proof.mjs <a.png> [b.png] [--region x,y,w,h] [--grid 20] [--top 12]\n" +
      "      [--expect-diff | --expect-same | --expect-content [ratio]] [--quiet] [--json]",
  );
  process.exit(2);
}

/* ---------------- PNG 解码（8 位非隔行；零依赖） ---------------- */

/**
 * 解 PNG → { width, height, rgb:Uint8Array(3 通道) }。
 * 不支持的形态**直接抛错**，不静默降级（见头部「能力边界」）。
 */
function decodePng(buf, label) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error(`${label}：不是 PNG（签名不符）`);
  }
  let off = 8;
  let ihdr = null;
  let palette = null;
  let hasTrns = false;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") hasTrns = true;
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error(`${label}：缺 IHDR`);
  if (ihdr.bitDepth !== 8) throw new Error(`${label}：只支持 8 位 PNG（实际 ${ihdr.bitDepth} 位）——本装置不假装支持它没实现的解码路径`);
  if (ihdr.interlace !== 0) throw new Error(`${label}：不支持隔行（Adam7）PNG`);
  const chMap = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = chMap[ihdr.colorType];
  if (!ch) throw new Error(`${label}：不支持的 colorType=${ihdr.colorType}`);
  if (ihdr.colorType === 3 && !palette) throw new Error(`${label}：调色板图缺 PLTE`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * ch;
  const px = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    if (p >= raw.length) throw new Error(`${label}：IDAT 数据不足（第 ${y} 行）`);
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    if (line.length < stride) throw new Error(`${label}：IDAT 数据不足（第 ${y} 行）`);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (ft !== 0) throw new Error(`${label}：未知 filter type=${ft}（第 ${y} 行）`);
      cur[x] = v & 0xff;
    }
  }

  // 统一转成 3 通道 RGB（调色板展开、灰度复制、丢弃 alpha）
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, o = 0; i < width * height; i++, o += 3) {
    const s = i * ch;
    if (ihdr.colorType === 3) {
      const idx = px[s] * 3;
      rgb[o] = palette[idx];
      rgb[o + 1] = palette[idx + 1];
      rgb[o + 2] = palette[idx + 2];
    } else if (ihdr.colorType === 0 || ihdr.colorType === 4) {
      rgb[o] = rgb[o + 1] = rgb[o + 2] = px[s];
    } else {
      rgb[o] = px[s];
      rgb[o + 1] = px[s + 1];
      rgb[o + 2] = px[s + 2];
    }
  }
  return { width, height, rgb, hasTrns, colorType: ihdr.colorType };
}

/* ---------------- 统计 ---------------- */

const hex = (n) => n.toString(16).padStart(2, "0");

/** 直方图 + 底色/非底色 + 分区密度 */
function analyse(img, region, grid) {
  const { width, height, rgb } = img;
  const [x0, y0, w, h] = region;
  const counts = new Map();
  let total = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 3;
      const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
      total++;
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const bg = top[0][0];
  const bgCount = top[0][1];
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    const row = [];
    for (let gx = 0; gx < grid; gx++) {
      const cx0 = x0 + Math.floor((gx * w) / grid);
      const cx1 = x0 + Math.floor(((gx + 1) * w) / grid);
      const cy0 = y0 + Math.floor((gy * h) / grid);
      const cy1 = y0 + Math.floor(((gy + 1) * h) / grid);
      let cnt = 0;
      let tot = 0;
      for (let y = cy0; y < cy1; y++) {
        for (let x = cx0; x < cx1; x++) {
          const i = (y * width + x) * 3;
          const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
          if (key !== bg) cnt++;
          tot++;
        }
      }
      row.push(tot ? cnt / tot : 0);
    }
    cells.push(row);
  }
  return {
    size: `${w}x${h}`,
    pixels: total,
    distinctColors: counts.size,
    top: top.slice(0, TOP).map(([k, n]) => ({
      hex: `#${hex(k >> 16)}${hex((k >> 8) & 0xff)}${hex(k & 0xff)}`,
      count: n,
      ratio: n / total,
    })),
    bg: `#${hex(bg >> 16)}${hex((bg >> 8) & 0xff)}${hex(bg & 0xff)}`,
    bgRatio: bgCount / total,
    nonBgRatio: 1 - bgCount / total,
    cells,
  };
}

/** 逐像素差异（要求同尺寸同区域） */
function diff(a, b, region) {
  const [x0, y0, w, h] = region;
  let changed = 0;
  let maxCh = 0;
  let sumCh = 0;
  let total = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * a.width + x) * 3;
      const dr = Math.abs(a.rgb[i] - b.rgb[i]);
      const dg = Math.abs(a.rgb[i + 1] - b.rgb[i + 1]);
      const db = Math.abs(a.rgb[i + 2] - b.rgb[i + 2]);
      const d = Math.max(dr, dg, db);
      if (d > 0) changed++;
      if (d > maxCh) maxCh = d;
      sumCh += dr + dg + db;
      total++;
    }
  }
  return { pixels: total, changed, changedRatio: changed / total, maxChannelDelta: maxCh, meanChannelDelta: sumCh / (total * 3) };
}

/* ---------------- 主流程 ---------------- */

const paths = positionals.map((p) => path.resolve(p));
const images = [];
for (const p of paths) {
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    console.error(`读不到文件：${p} —— ${e.message}`);
    process.exit(2);
  }
  try {
    images.push(decodePng(buf, path.basename(p)));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

// 区域解析（默认整图；A/B 时要求两图同尺寸）
let region = null;
if (hasOpt("--region")) {
  const raw = optOf("--region");
  const m = raw === undefined ? null : /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(String(raw).trim());
  if (!m) {
    console.error(`--region 需形如 x,y,w,h${raw === undefined ? "（实测：给了 --region 但没给值）" : `（收到「${raw}」）`}`);
    process.exit(2);
  }
  region = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}
const [A, B] = images;
if (B && (A.width !== B.width || A.height !== B.height)) {
  console.error(
    `两图尺寸不同（${A.width}x${A.height} vs ${B.width}x${B.height}）—— 拒绝比对。` +
      `本装置不做裁剪或缩放：那会伪造可比性（同 lessons #77 的立场）。`,
  );
  process.exit(2);
}
const W = region ? region[2] : A.width;
const H = region ? region[3] : A.height;
const X0 = region ? region[0] : 0;
const Y0 = region ? region[1] : 0;
if (X0 + W > A.width || Y0 + H > A.height) {
  console.error(`--region ${X0},${Y0},${W},${H} 越出图像 ${A.width}x${A.height}`);
  process.exit(2);
}
const REGION = [X0, Y0, W, H];

const statA = analyse(A, REGION, GRID);
const statB = B ? analyse(B, REGION, GRID) : null;
const d = B ? diff(A, B, REGION) : null;

/* ---------------- 断言（把结论变成退出码） ---------------- */

const verdicts = [];
if (flag("--expect-diff")) {
  verdicts.push({ name: "--expect-diff", ok: d.changed > 0, detail: `差异像素 ${d.changed}/${d.pixels}（${(d.changedRatio * 100).toFixed(4)}%）` });
}
if (flag("--expect-same")) {
  verdicts.push({ name: "--expect-same", ok: d.changed === 0, detail: `差异像素 ${d.changed}/${d.pixels}` });
}
if (flag("--expect-content")) {
  // 该开关可带一个数值（`--expect-content 0.01`）；不带则按 0（只要不是纯色）
  const raw = optOf("--expect-content");
  const min = raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(min)) {
    console.error(`--expect-content 的阈值需要是数字（收到「${raw}」）`);
    process.exit(2);
  }
  verdicts.push({
    name: `--expect-content${min ? ` ${min}` : ""}`,
    ok: statA.nonBgRatio > min,
    detail: `非底色占比 ${(statA.nonBgRatio * 100).toFixed(4)}%（要求 > ${(min * 100).toFixed(4)}%），底色 ${statA.bg}`,
  });
}

/* ---------------- 输出 ---------------- */

const ramp = " .:-=+*#%@";
const anyFail = verdicts.some((v) => !v.ok);
if (JSON_ONLY) {
  // **JSON 模式只输出 JSON 一行**——否则 `| jq` 与 JSON.parse(stdout) 全都会失败，
  // 「机器可读」就成了空话。判据结果在 `verdicts` 里，退出码同样照实反映。
  // `cells` 压成「每行一个字符串」（与文本模式的密度图同形），避免 64x64 时膨胀成上万行。
  console.log(
    JSON.stringify(
      {
        tool: "pixel-proof",
        ok: !anyFail,
        images: paths.map((p, i) => ({ path: p, width: images[i].width, height: images[i].height, colorType: images[i].colorType, hasTrns: images[i].hasTrns })),
        region: REGION,
        a: { ...statA, cells: statA.cells.map((row) => row.map((r) => (r > 0 ? ramp[Math.min(9, Math.ceil(r * 9))] : " ")).join("")) },
        b: statB ? { ...statB, cells: statB.cells.map((row) => row.map((r) => (r > 0 ? ramp[Math.min(9, Math.ceil(r * 9))] : " ")).join("")) } : null,
        diff: d,
        verdicts,
        _meta: {
          grid: GRID,
          note: "调色板图的 tRNS 被忽略（按不透明处理）；alpha 通道不参与比对（只比 RGB）；cells 每项为一个密度图行（字符越重越密）",
        },
      },
      null,
      2,
    ),
  );
} else {
  const bar = "=".repeat(62);
  console.log(bar);
  console.log(`pixel-proof —— 效果类参数的像素可见性装置（1.3 · C1）`);
  console.log(bar);
  console.log(`  区域 ${X0},${Y0} ${W}x${H}${region ? "（--region 指定）" : "（整图）"}  网格 ${GRID}x${GRID}`);
  for (let i = 0; i < paths.length; i++) {
    console.log(`  图 ${i ? "B" : "A"}  ${path.basename(paths[i])}  ${images[i].width}x${images[i].height}  colorType=${images[i].colorType}${images[i].hasTrns ? "（含 tRNS，已忽略：按不透明处理）" : ""}`);
  }
  for (const [tag, s] of [["A", statA], ["B", statB]]) {
    if (!s) continue;
    console.log("");
    console.log(`  ── 图 ${tag} 直方图 ──  不同颜色 ${s.distinctColors} ｜ 底色 ${s.bg} 占 ${(s.bgRatio * 100).toFixed(2)}% ｜ 非底色 ${(s.nonBgRatio * 100).toFixed(2)}%`);
    if (!QUIET) {
      for (const t of s.top) console.log(`     ${t.hex}  ${String(t.count).padStart(8)}  ${(t.ratio * 100).toFixed(3)}%`);
      console.log(`   ── 图 ${tag} 分区非底色密度（${GRID}x${GRID}，越密字符越重）──`);
      for (const row of s.cells) {
        console.log("     |" + row.map((r) => (r > 0 ? ramp[Math.min(9, Math.ceil(r * 9))] : " ")).join("") + "|");
      }
    }
  }
  if (d) {
    console.log("");
    console.log(`  ── A/B 逐像素差异 ──`);
    console.log(`     差异像素 ${d.changed} / ${d.pixels}  （${(d.changedRatio * 100).toFixed(4)}%）`);
    console.log(`     最大通道差 ${d.maxChannelDelta} ｜ 平均通道差 ${d.meanChannelDelta.toFixed(4)}`);
  }
  console.log(bar);
}

if (!JSON_ONLY) {
  for (const v of verdicts) {
    console.log(`  ${v.ok ? "PASS" : "FAIL"}  ${v.name} —— ${v.detail}`);
  }

  if (anyFail) {
    console.log(`\n结果：${verdicts.filter((v) => v.ok).length} PASS / ${verdicts.filter((v) => !v.ok).length} FAIL —— 像素判据不成立`);
  } else if (!verdicts.length) {
    console.log(`\n结果：仅报告统计（未给判据开关）。差异像素 ${d ? d.changed : "—"}；非底色占比 ${(statA.nonBgRatio * 100).toFixed(4)}%`);
  } else {
    console.log(`\n结果：${verdicts.length} PASS / 0 FAIL —— 像素判据全部成立`);
  }
}

if (anyFail) process.exit(1);

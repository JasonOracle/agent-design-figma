/**
 * agent-design-figma Bridge - Figma plugin MAIN THREAD (Plugin API realm)
 * ------------------------------------------------------------------
 * This file runs inside Figma's plugin sandbox and is the ONLY place
 * allowed to call the Figma Plugin API (figma.createFrame, etc.).
 *
 * It has no network access of its own. It receives commands from the
 * plugin UI iframe via figma.ui.onmessage, executes them with the
 * Plugin API, and posts back an explicit ok / error result.
 *
 * Contract (must stay in sync with plugin/ui.html):
 *   UI  -> main : { type: "vibe:exec", id, op, params }
 *   main -> UI  : { type: "vibe:result", id, ok, data }  |  { id, ok:false, error }
 * ------------------------------------------------------------------
 */

const UI_WIDTH = 400;
const UI_HEIGHT = 520;

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: UI_HEIGHT,
  themeColors: true,
  title: "agent-design-figma Bridge",
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Convert a SOLID paint to "#rrggbb"; other paint types become null. */
function paintToHex(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return "#" + h(paint.color.r) + h(paint.color.g) + h(paint.color.b);
}

/**
 * Style + layout state, so a caller can verify a write really landed
 * (fills, strokes, opacity, corner radius, auto layout, text font).
 *
 * Every read is guarded: plenty of node types simply do not have these
 * properties, and some throw when the value is mixed.
 */
function styleInfo(node) {
  const out = {};
  const guard = (fn) => { try { fn(); } catch (_) { /* not applicable to this node type */ } };

  guard(() => { if ("opacity" in node) out.opacity = Math.round(node.opacity * 1000) / 1000; });

  guard(() => {
    if ("fills" in node && node.fills !== figma.mixed) {
      out.fills = node.fills.map(paintToHex).filter(Boolean);
      out.fillCount = node.fills.length;
      // FR-5 · paint 级透明度平行数组（与 node.fills **逐位对齐**，未过滤）：
      // 不透明 paint 也给 1，保持「fills[i] 的透明度 = fillOpacities[i]」这一不变式；
      // 非 SOLID paint（渐变/图片）取 paint.opacity ?? 1。不改 fills 值格式 ——
      // anchor-compare 等消费方按 "#rrggbb" 解析，后缀写法会砸到它们。
      out.fillOpacities = node.fills.map((p) => (p && typeof p.opacity === "number" ? Math.round(p.opacity * 1000) / 1000 : 1));
      // F2 · IMAGE paint 不进 fills（paintToHex 只认 SOLID，返回 null 被滤掉），
      // 但「图片填没填上」必须可回读核验 —— 单列 imageFills（hash:scaleMode）。
      const images = node.fills
        .filter((p) => p && p.type === "IMAGE" && p.imageHash)
        .map((p) => `image:${p.imageHash}:${p.scaleMode || "FILL"}`);
      if (images.length) out.imageFills = images;
    }
  });

  guard(() => {
    if ("strokes" in node && node.strokes !== figma.mixed) {
      out.strokes = node.strokes.map(paintToHex).filter(Boolean);
      if ("strokeWeight" in node && node.strokeWeight !== figma.mixed) out.strokeWeight = node.strokeWeight;
    }
  });

  guard(() => {
    if ("cornerRadius" in node && node.cornerRadius !== figma.mixed) out.cornerRadius = node.cornerRadius;
  });

  guard(() => {
    if (!("layoutMode" in node)) return;
    out.layoutMode = node.layoutMode;
    if (node.layoutMode === "NONE") return;
    out.itemSpacing = node.itemSpacing;
    out.padding = { top: node.paddingTop, right: node.paddingRight, bottom: node.paddingBottom, left: node.paddingLeft };
    out.primaryAxisAlignItems = node.primaryAxisAlignItems;
    out.counterAxisAlignItems = node.counterAxisAlignItems;
    out.primaryAxisSizingMode = node.primaryAxisSizingMode;
    out.counterAxisSizingMode = node.counterAxisSizingMode;
  });

  guard(() => {
    if (node.type !== "TEXT") return;
    if (node.fontName !== figma.mixed) out.fontName = { family: node.fontName.family, style: node.fontName.style };
    if (node.fontSize !== figma.mixed) out.fontSize = node.fontSize;
    // FR-2 · 数值字重（better-typography「18px 以下 ≥400」「300 以下只配 28px+」的输入）。
    // 混排回 null —— fontName 的缺席本身就是混排标记；认不出的 style 也回 null（不猜）。
    out.fontWeight = node.fontName === figma.mixed ? null : fontWeightFromStyle(node.fontName.style);
  });

  // How this node is sized by its parent's auto layout. Needed to prove a
  // HUG/FILL really landed, and to audit a finished page.
  guard(() => {
    if (!("layoutSizingHorizontal" in node)) return;
    out.layoutSizing = { horizontal: node.layoutSizingHorizontal, vertical: node.layoutSizingVertical };
  });

  guard(() => {
    if (node.type !== "TEXT") return;
    out.textAlign = { horizontal: node.textAlignHorizontal, vertical: node.textAlignVertical };
    out.textAutoResize = node.textAutoResize;
    // FR-3 / FR-4 · 原生 {value, unit} 直传（unit = PIXELS | PERCENT | AUTO）。
    // 混排（selection 内取值不一致）时为 figma.mixed ⇒ 回 null —— 语义是
    // 「不可用单一值表达」，与「没设置」区分开（AUTO 时 value 无意义）。
    out.lineHeight = node.lineHeight === figma.mixed ? null : node.lineHeight;
    out.letterSpacing = node.letterSpacing === figma.mixed ? null : node.letterSpacing;
  });

  // Drop shadow / blur. Without this there is no way to prove a soft shadow
  // was actually written to the canvas.
  guard(() => {
    if (!("effects" in node) || !Array.isArray(node.effects)) return;
    out.effects = node.effects.map((e) => ({
      type: e.type,
      radius: e.radius,
      spread: e.spread,
      offset: e.offset,
      color: e.color
        ? `rgba(${Math.round(e.color.r * 255)},${Math.round(e.color.g * 255)},${Math.round(e.color.b * 255)},${
            Math.round((e.color.a === undefined ? 1 : e.color.a) * 100) / 100})`
        : undefined,
      visible: e.visible !== false,
    }));
  });

  // A chart must be real editable geometry, so its path is part of its state.
  guard(() => {
    if (node.type !== "VECTOR") return;
    out.vectorPathCount = node.vectorPaths.length;
    if (node.vectorPaths.length) out.vectorData = String(node.vectorPaths[0].data).slice(0, 200);
  });

  guard(() => { if ("clipsContent" in node) out.clipsContent = node.clipsContent; });

  return out;
}

/**
 * @param node
 * @param {{depth?: number, detail?: boolean}} [opts]
 *   depth: how many child levels to include (default 1 = direct children only,
 *          which is the original behaviour; 0 = no children at all).
 *   detail: children carry their full style state instead of id/name/type.
 *          A deep, detailed read is what makes a real design audit possible.
 */
function nodeInfo(node, opts) {
  const o = opts || {};
  const depth = o.depth === undefined ? 1 : o.depth;
  const info = {
    id: node.id,
    name: node.name,
    type: node.type,
    width: Math.round(node.width * 100) / 100,
    height: Math.round(node.height * 100) / 100,
    x: Math.round(node.x * 100) / 100,
    y: Math.round(node.y * 100) / 100,
  };
  if (typeof node.characters === "string") info.characters = node.characters;
  if (node.parent) info.parentId = node.parent.id;
  if (typeof node.children !== "undefined") {
    info.childCount = node.children.length;
    if (depth > 0) {
      info.children = node.children.map((c) => {
        if (o.detail) return nodeInfo(c, { depth: depth - 1, detail: true });
        // `depth` has to work on its own. It used to be ignored unless
        // `detail:true` came along, so get-node {depth:2} answered with
        // children-only shells whose grandchildren were never in the payload -
        // a layout audit then burned an extra roundtrip per node to find that
        // out, and large pages made that the dominant cost. depth:1 keeps the
        // original light shape (id/name/type) so existing callers see no
        // payload growth.
        if (depth > 1) return nodeInfo(c, { depth: depth - 1, detail: false });
        return { id: c.id, name: c.name, type: c.type };
      });
    }
  }
  Object.assign(info, styleInfo(node));
  return info;
}

function fail(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

/**
 * Resolve a parent node: explicit parentId, else current page.
 * NOTE: with documentAccess "dynamic-page" the sync figma.getNodeById is
 * banned ("Cannot call with documentAccess: dynamic-page"). Only the async
 * variant is allowed, so this must be awaited.
 */
async function resolveParent(parentId) {
  if (!parentId) return figma.currentPage;
  const node = await figma.getNodeByIdAsync(parentId);
  if (!node) throw fail(`Parent node not found: ${parentId}`, "PARENT_NOT_FOUND");
  if (!("appendChild" in node)) {
    throw fail(`Parent node cannot contain children: ${parentId} (${node.type})`, "PARENT_NOT_CONTAINER");
  }
  return node;
}

function num(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw fail(`Invalid number for "${label}": ${JSON.stringify(value)}`, "BAD_PARAM");
  return n;
}

/** Like num(), but "not supplied" stays undefined instead of taking a default. */
function optNum(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  return num(value, undefined, label);
}

/** Fetch a node by id with a clear error when it is missing. */
async function getNode(id, label) {
  if (id === undefined || id === null || id === "") {
    throw fail(`Missing required param: ${label || "id"}`, "BAD_PARAM");
  }
  if (typeof id !== "string") {
    throw fail(`Param "${label || "id"}" must be a node id string, got ${JSON.stringify(id)}`, "BAD_PARAM");
  }
  const node = await figma.getNodeByIdAsync(id);
  if (!node) throw fail(`Node not found: ${id}`, "NODE_NOT_FOUND");
  return node;
}

/** "#rrggbb" | "#rgb" -> { r, g, b } in 0..1 (Figma's colour space). */
function hexTo01(hex) {
  let s = String(hex).trim().replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length === 8) s = s.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) {
    throw fail(`Invalid hex colour "${hex}" - expected #rrggbb or #rgb`, "BAD_PARAM");
  }
  return {
    r: parseInt(s.slice(0, 2), 16) / 255,
    g: parseInt(s.slice(2, 4), 16) / 255,
    b: parseInt(s.slice(4, 6), 16) / 255,
  };
}

/**
 * Normalise a colour spec into a Figma SOLID paint. Accepted shapes:
 *   { hex: "#4a6cff", opacity: 0.5 } | { rgb: [74,108,255] } | "#4a6cff" | [74,108,255]
 */
function toPaint(spec) {
  if (spec === undefined || spec === null) throw fail("Missing colour", "BAD_PARAM");
  let color = null;
  let opacity;
  if (Array.isArray(spec)) {
    if (spec.length !== 3) throw fail(`rgb needs exactly 3 entries, got ${spec.length}`, "BAD_PARAM");
    color = { r: spec[0] / 255, g: spec[1] / 255, b: spec[2] / 255 };
  } else if (typeof spec === "string") {
    color = hexTo01(spec);
  } else if (typeof spec === "object") {
    opacity = optNum(spec.opacity, "opacity");
    if (typeof spec.hex === "string") color = hexTo01(spec.hex);
    else if (Array.isArray(spec.rgb)) {
      if (spec.rgb.length !== 3) throw fail(`rgb needs exactly 3 entries, got ${spec.rgb.length}`, "BAD_PARAM");
      color = { r: spec.rgb[0] / 255, g: spec.rgb[1] / 255, b: spec.rgb[2] / 255 };
    } else if (typeof spec.color === "string") color = hexTo01(spec.color);
  }
  if (!color) throw fail(`Unrecognised colour: ${JSON.stringify(spec)}`, "BAD_PARAM");
  const paint = { type: "SOLID", color };
  if (opacity !== undefined) paint.opacity = Math.max(0, Math.min(1, opacity));
  return paint;
}

/**
 * Text properties (characters / fontName / fontSize / ...) can only be
 * written once the font in use is loaded - otherwise Figma throws
 * "Cannot write to node with unloaded font".
 */
async function ensureFontLoaded(node) {
  if (node.type !== "TEXT") {
    throw fail(`Node is not a TEXT node: ${node.id} (${node.type})`, "NOT_A_TEXT_NODE");
  }
  const fn = node.fontName;
  if (fn === figma.mixed) {
    throw fail(`Node ${node.id} uses several fonts in one text node; set one font first with set-font`, "MIXED_FONT");
  }
  await figma.loadFontAsync(fn);
  return fn;
}

/** Numeric weight -> plausible style names, most likely first. */
const WEIGHT_STYLES = {
  100: ["Thin", "Hairline"],
  200: ["Extra Light", "ExtraLight", "Ultra Light"],
  300: ["Light"],
  400: ["Regular", "Normal", "Book"],
  500: ["Medium"],
  600: ["Semi Bold", "SemiBold", "Demi Bold", "DemiBold"],
  700: ["Bold"],
  800: ["Extra Bold", "ExtraBold", "Ultra Bold"],
  900: ["Black", "Heavy"],
};

/**
 * FR-2 · style 名 -> 数值字重（WEIGHT_STYLES 的逆映射，单一事实源）。
 * 不区分大小写、忽略 Italic 后缀；认不出的 style（如 Condensed Bold）回 null ——
 * 宁可 null 也不猜。混排（fontName === figma.mixed）也回 null：fontName 缺席
 * 本身就是混排信号，不再造第二个标记字段（一个事实一个符号）。
 */
const STYLE_WEIGHTS = (() => {
  const m = {};
  for (const [w, names] of Object.entries(WEIGHT_STYLES)) for (const n of names) m[n.toLowerCase()] = Number(w);
  return m;
})();
function fontWeightFromStyle(style) {
  if (typeof style !== "string") return null;
  const s = style.toLowerCase().replace(/\s+/g, " ").trim();
  if (STYLE_WEIGHTS[s] !== undefined) return STYLE_WEIGHTS[s];
  if (s.endsWith(" italic") && STYLE_WEIGHTS[s.slice(0, -7)] !== undefined) return STYLE_WEIGHTS[s.slice(0, -7)];
  if (s.startsWith("italic ") && STYLE_WEIGHTS[s.slice(7)] !== undefined) return STYLE_WEIGHTS[s.slice(7)];
  return null;
}

/**
 * Families disagree on style names ("Semi Bold" vs "SemiBold"), so probe
 * candidates with loadFontAsync rather than guessing one spelling.
 */
async function resolveStyleName(family, weight, italic) {
  const bases = WEIGHT_STYLES[weight];
  if (!bases) throw fail(`Unsupported weight ${weight} - use 100..900 in steps of 100`, "BAD_PARAM");
  const tried = [];
  for (const base of bases) {
    const names = italic ? [`${base} Italic`, base === "Regular" ? "Italic" : null] : [base];
    for (const style of names) {
      if (!style) continue;
      tried.push(style);
      try {
        await figma.loadFontAsync({ family, style });
        return style;
      } catch (_) { /* this family spells it differently - keep probing */ }
    }
  }
  throw fail(
    `Font "${family}" has no ${italic ? "italic " : ""}weight ${weight}. Tried: ${tried.join(", ")}`,
    "FONT_STYLE_NOT_FOUND"
  );
}

/**
 * Auto layout properties only exist on containers that actually have auto
 * layout switched on. Failing with a readable code beats Figma's generic
 * "cannot set property" error.
 */
function requireAutoLayout(node, op) {
  if (!("layoutMode" in node)) {
    throw fail(`${op}: node does not support auto layout: ${node.id} (${node.type})`, "NO_AUTO_LAYOUT");
  }
  if (node.layoutMode === "NONE") {
    throw fail(`${op}: node has no auto layout yet - run set-auto-layout first (node ${node.id})`, "NO_AUTO_LAYOUT");
  }
  return node;
}

/** Normalise an alignment word ("space-between", "start") to Figma's enum. */
function normAlign(value, allowed, label) {
  if (value === undefined || value === null || value === "") {
    throw fail(`${label} needs align. Use ${allowed.join(", ")}`, "BAD_PARAM");
  }
  const raw = String(value).trim().toUpperCase().replace(/-/g, "_");
  const aliases = { START: "MIN", TOP: "MIN", LEFT: "MIN", END: "MAX", BOTTOM: "MAX", RIGHT: "MAX", MIDDLE: "CENTER" };
  const resolved = allowed.includes(raw) ? raw : aliases[raw];
  if (!resolved || !allowed.includes(resolved)) {
    throw fail(`${label}: unsupported align "${value}". Use ${allowed.join(", ")}`, "BAD_PARAM");
  }
  return resolved;
}

/** Normalise a word onto one of Figma's enum values, with a readable failure. */
function normEnum(value, allowed, label, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback === undefined) {
      throw fail(`${label} needs a value. Use ${allowed.join(", ")}`, "BAD_PARAM");
    }
    return fallback;
  }
  const v = String(value).trim().toUpperCase().replace(/[-\s]/g, "_");
  if (!allowed.includes(v)) {
    throw fail(`${label}: unsupported value "${value}". Use ${allowed.join(", ")}`, "BAD_PARAM");
  }
  return v;
}

/** Text auto-sizing aliases -> Figma's TextAutoResize enum. */
function normAutoResize(value) {
  const MAP = {
    NONE: "NONE", FIXED: "NONE", FIX: "NONE",
    WIDTH_AND_HEIGHT: "WIDTH_AND_HEIGHT", AUTO: "WIDTH_AND_HEIGHT", BOTH: "WIDTH_AND_HEIGHT",
    AUTO_WIDTH: "WIDTH_AND_HEIGHT", HUG_BOTH: "WIDTH_AND_HEIGHT",
    HEIGHT: "HEIGHT", AUTO_HEIGHT: "HEIGHT", HUG_HEIGHT: "HEIGHT",
    TRUNCATE: "TRUNCATE", TRUNCATE_TAIL: "TRUNCATE",
  };
  const v = String(value).trim().toUpperCase().replace(/[-\s]/g, "_");
  const mode = MAP[v];
  if (!mode) {
    throw fail(`Unsupported autoResize "${value}". Use NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE`, "BAD_PARAM");
  }
  return mode;
}

/**
 * Params that name a node. "@last" is only meaningful in these, so a typo
 * like {"name": "@last"} fails loudly instead of silently setting a name.
 */
const ID_KEYS = ["id", "parentId", "childId", "nodeId", "componentId", "targetId", "from"];

/** True when a node lays its children out itself (so x/y is not ours to set). */
function isAutoLayoutContainer(node) {
  return !!node && "layoutMode" in node && node.layoutMode !== "NONE";
}

/**
 * Position a freshly appended child.
 *
 * An auto-layout parent owns its children's coordinates, so writing x/y there
 * is either ignored or fights the layout engine. Skipping it keeps bulk builds
 * deterministic: order of appendChild decides order, the layout decides pixels.
 * For every other parent this behaves exactly like before (defaults to 0).
 */
function placeInParent(node, parent, x, y) {
  if (isAutoLayoutContainer(parent)) return;
  node.x = num(x, 0, "x");
  node.y = num(y, 0, "y");
}

/**
 * F2 · 图片字节经 UI 从 Bridge 同域端点取回。
 * 主线程没有网络；manifest.allowedDomains 只有 localhost:45677（Bridge），
 * 所以字节链路只能是：主线程 → postMessage 请求 → UI fetch(/v1/asset) →
 * base64 回传 → figma.base64Decode。实现路径见 1.2-plan.md 附录。
 */
const pendingAssetFetches = new Map(); // reqId -> {resolve, reject}
let assetReqSeq = 0;

function fetchAssetBytes(name) {
  return new Promise((resolve, reject) => {
    const reqId = `asset:${++assetReqSeq}`;
    const timer = setTimeout(() => {
      pendingAssetFetches.delete(reqId);
      reject(fail(`取图片超时：${name}（UI 30s 未应答 —— 检查 Bridge 是否在跑、.vibe/assets/ 里有没有这个文件）`, "ASSET_TIMEOUT"));
    }, 30000);
    pendingAssetFetches.set(reqId, { resolve, reject });
    figma.ui.postMessage({ type: "vibe:fetch-asset", reqId, name });
  });
}

/* ------------------------------------------------------------------ */
/* operations - each returns a plain JSON-serializable payload         */
/* ------------------------------------------------------------------ */

const handlers = {
  /** Health / liveness probe from the bridge. */
  async ping() {
    return {
      plugin: "agent-design-figma Bridge (Dev)",
      fileKey: figma.fileKey || null,
      page: figma.currentPage.name,
      pageId: figma.currentPage.id,
      editorType: figma.editorType,
      documentAccess: "dynamic-page",
      timestamp: Date.now(),
    };
  },

  /** Lightweight canvas read-back so the caller can verify writes. */
  async "get-page-summary"() {
    return {
      page: { id: figma.currentPage.id, name: figma.currentPage.name },
      selection: figma.currentPage.selection.map((n) => ({ id: n.id, name: n.name, type: n.type })),
      nodes: figma.currentPage.children.map(nodeInfo),
      nodeCount: figma.currentPage.children.length,
    };
  },

  /** Full detail for one node; depth/detail expose the whole subtree. */
  async "get-node"({ id, depth, detail }) {
    if (!id) throw fail("Missing required param: id", "BAD_PARAM");
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw fail(`Node not found: ${id}`, "NODE_NOT_FOUND");
    const info = nodeInfo(node, { depth: num(depth, 1, "depth"), detail: detail === true });
    info.selection = figma.currentPage.selection.map((n) => n.id).includes(node.id);
    return info;
  },

  /** Rename a node - keeps a bulk-built page auditable and readable. */
  async "set-name"({ id, name }) {
    const node = await getNode(id);
    if (typeof name !== "string" || !name.trim()) throw fail("set-name needs a non-empty name", "BAD_PARAM");
    const before = node.name;
    node.name = name;
    return { updated: nodeInfo(node, { depth: 0 }), previousName: before, op: "set-name" };
  },

  /** Create a native FRAME, optionally inside a parent. */
  async "create-frame"({ name, width, height, x, y, parentId, fill, clips }) {
    const w = num(width, 1440, "width");
    const h = num(height, 900, "height");
    const frame = figma.createFrame();
    frame.name = name || "Frame";
    const parent = await resolveParent(parentId);
    parent.appendChild(frame);
    frame.resize(w, h);
    placeInParent(frame, parent, x, y);
    if (fill) frame.fills = [toPaint(fill)];
    if (clips !== undefined) frame.clipsContent = clips === true || clips === "true";
    figma.currentPage.selection = [frame];
    // Only chase the viewport for a top-level frame: a bulk build of nested
    // frames would otherwise drag the canvas around on every single node.
    if (!parentId) figma.viewport.scrollAndZoomIntoView([frame]);
    return { created: nodeInfo(frame, { depth: 0 }), op: "create-frame" };
  },

  /** Create a native RECTANGLE, optionally inside a parent. */
  async "create-rect"({ name, width, height, x, y, parentId, fill, cornerRadius }) {
    const w = num(width, 300, "width");
    const h = num(height, 100, "height");
    const rect = figma.createRectangle();
    rect.name = name || "Rectangle";
    rect.resize(w, h);
    const parent = await resolveParent(parentId);
    parent.appendChild(rect);
    placeInParent(rect, parent, x, y);
    if (fill) rect.fills = [toPaint(fill)];
    const cr = optNum(cornerRadius, "cornerRadius");
    if (cr !== undefined && "cornerRadius" in rect) rect.cornerRadius = cr;
    figma.currentPage.selection = [rect];
    return { created: nodeInfo(rect, { depth: 0 }), op: "create-rect" };
  },

  /** Create a native TEXT node. Fonts must be loaded before writing characters. */
  async "create-text"({ characters, text, x, y, fontSize, parentId, fontFamily, fontStyle, name, fill, autoResize }) {
    const content = characters !== undefined ? characters : text;
    if (typeof content !== "string" || content.length === 0) {
      throw fail("Missing required param: characters", "BAD_PARAM");
    }
    const family = fontFamily || "Inter";
    const style = fontStyle || "Regular";
    await figma.loadFontAsync({ family, style });

    const t = figma.createText();
    t.fontName = { family, style };
    t.fontSize = num(fontSize, 48, "fontSize");
    t.characters = content;
    if (name) t.name = name;
    const parent = await resolveParent(parentId);
    parent.appendChild(t);
    placeInParent(t, parent, x, y);
    if (fill) t.fills = [toPaint(fill)];
    if (autoResize !== undefined) t.textAutoResize = normAutoResize(autoResize);
    figma.currentPage.selection = [t];
    return { created: nodeInfo(t, { depth: 0 }), op: "create-text" };
  },

  /** Create a native ELLIPSE, optionally inside a parent. */
  async "create-ellipse"({ name, width, height, x, y, parentId, fill }) {
    const e = figma.createEllipse();
    e.name = name || "Ellipse";
    e.resize(num(width, 200, "width"), num(height, 200, "height"));
    const parent = await resolveParent(parentId);
    parent.appendChild(e);
    placeInParent(e, parent, x, y);
    if (fill) e.fills = [toPaint(fill)];
    figma.currentPage.selection = [e];
    return { created: nodeInfo(e, { depth: 0 }), op: "create-ellipse" };
  },

  /** Create a native LINE. A line has no height - its length goes in width. */
  async "create-line"({ name, length, width, x, y, rotation, parentId, stroke, strokeWeight }) {
    const len = num(length !== undefined && length !== null ? length : width, 200, "length");
    const line = figma.createLine();
    line.name = name || "Line";
    line.resize(len, 0);
    const parent = await resolveParent(parentId);
    parent.appendChild(line);
    placeInParent(line, parent, x, y);
    const rot = optNum(rotation, "rotation");
    if (rot !== undefined) line.rotation = rot;
    if (stroke) line.strokes = [toPaint(stroke)];
    const sw = optNum(strokeWeight, "strokeWeight");
    if (sw !== undefined) line.strokeWeight = sw;
    figma.currentPage.selection = [line];
    return { created: nodeInfo(line, { depth: 0 }), op: "create-line" };
  },

  /**
   * Create a real, editable VECTOR - the only honest way to draw a chart line
   * or an icon outline. `points` are read in the PARENT's coordinate space and
   * are normalised internally, so a caller can lay out a chart in plain
   * chart-local coordinates without fighting node bounds.
   */
  async "create-vector"({ name, points, data, closed, x, y, width, height, parentId, stroke, strokeWeight, strokeCap, strokeJoin, fill }) {
    const isClosed = closed === true || closed === "true";
    if (stroke === undefined && fill === undefined) {
      throw fail("create-vector needs a stroke or a fill (otherwise it draws nothing)", "BAD_PARAM");
    }

    let pathData = typeof data === "string" && data.trim() ? data.trim() : null;
    let originX = 0;
    let originY = 0;

    if (!pathData) {
      if (!Array.isArray(points) || points.length < 2) {
        throw fail("create-vector needs `points` (>= 2 [x, y] pairs) or raw path `data`", "BAD_PARAM");
      }
      const pts = points.map((p, i) => {
        if (!Array.isArray(p) || p.length < 2) throw fail(`points[${i}] must be [x, y]`, "BAD_PARAM");
        return [num(p[0], 0, `points[${i}][0]`), num(p[1], 0, `points[${i}][1]`)];
      });
      originX = Math.min(...pts.map((p) => p[0]));
      originY = Math.min(...pts.map((p) => p[1]));
      const r = (n) => Math.round(n * 1000) / 1000;
      pathData = "M " + pts.map((p) => `${r(p[0] - originX)} ${r(p[1] - originY)}`).join(" L ") + (isClosed ? " Z" : "");
    }

    const v = figma.createVector();
    v.name = name || "Vector";
    v.vectorPaths = [{ windingRule: isClosed ? "NONZERO" : "NONE", data: pathData }];
    const parent = await resolveParent(parentId);
    parent.appendChild(v);
    if (!isAutoLayoutContainer(parent)) {
      v.x = num(x, originX, "x");
      v.y = num(y, originY, "y");
    }

    const w = optNum(width, "width");
    const h = optNum(height, "height");
    if (w !== undefined || h !== undefined) {
      v.resize(w === undefined ? v.width : w, h === undefined ? v.height : h);
    }

    if (stroke !== undefined) {
      v.strokes = [toPaint(stroke)];
      v.strokeWeight = num(strokeWeight, 1, "strokeWeight");
      v.strokeCap = normEnum(strokeCap, ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"], "strokeCap", "ROUND");
      v.strokeJoin = normEnum(strokeJoin, ["MITER", "BEVEL", "ROUND"], "strokeJoin", "ROUND");
      // An outlined path with no fill is the normal case for a chart line.
      if (fill === undefined) v.fills = [];
    } else {
      // A filled shape with no stroke is the normal case for a chart AREA.
      // Without this, Figma's default 1px black stroke is left on the path and
      // draws a dark outline around the fill (found by the Stage 3 audit).
      v.strokes = [];
    }
    if (fill !== undefined) v.fills = [toPaint(fill)];

    figma.currentPage.selection = [v];
    return { created: nodeInfo(v, { depth: 0 }), op: "create-vector" };
  },

  /**
   * Duplicate a node; the copy can be re-parented and offset in one step.
   *
   * NOTE: the Plugin API method is clone(), NOT duplicate(). Verified on a
   * real canvas - typeof node.duplicate is "undefined" while clone is a
   * function, and "clone" is the only copy-like property on the prototype.
   */
  async "duplicate-node"({ id, name, parentId, x, y }) {
    const node = await getNode(id);
    if (typeof node.clone !== "function") {
      throw fail(`Node cannot be duplicated: ${id} (${node.type})`, "CANNOT_DUPLICATE");
    }
    const copy = node.clone();
    if (name) copy.name = name;
    if (parentId) {
      const parent = await resolveParent(parentId);
      parent.appendChild(copy);
    }
    const nx = optNum(x, "x");
    const ny = optNum(y, "y");
    if (nx !== undefined) copy.x = nx;
    if (ny !== undefined) copy.y = ny;
    figma.currentPage.selection = [copy];
    return { created: nodeInfo(copy), sourceId: id, op: "duplicate-node" };
  },

  /** Move a node by absolute x/y, relative dx/dy, or a mix of both. */
  async "move-node"({ id, x, y, dx, dy }) {
    const node = await getNode(id);
    const nx = optNum(x, "x");
    const ny = optNum(y, "y");
    const ddx = optNum(dx, "dx");
    const ddy = optNum(dy, "dy");
    if (nx === undefined && ny === undefined && ddx === undefined && ddy === undefined) {
      throw fail("move-node needs at least one of: x, y, dx, dy", "BAD_PARAM");
    }
    const from = { x: node.x, y: node.y };
    if (nx !== undefined) node.x = nx;
    else if (ddx !== undefined) node.x = node.x + ddx;
    if (ny !== undefined) node.y = ny;
    else if (ddy !== undefined) node.y = node.y + ddy;
    return { updated: nodeInfo(node), movedFrom: from, op: "move-node" };
  },

  /** Resize a node; an omitted dimension keeps its current value. */
  async "resize-node"({ id, width, height }) {
    const node = await getNode(id);
    if (typeof node.resize !== "function") {
      throw fail(`Node cannot be resized: ${id} (${node.type})`, "CANNOT_RESIZE");
    }
    const w = num(width, node.width, "width");
    const h = num(height, node.height, "height");
    if (w <= 0 || h < 0) throw fail(`resize-node needs positive dimensions, got ${w}x${h}`, "BAD_PARAM");
    node.resize(w, h);
    return { updated: nodeInfo(node), op: "resize-node" };
  },

  /** Delete a node by id. */
  async "delete-node"({ id }) {
    const node = await getNode(id);
    const info = { id: node.id, name: node.name, type: node.type };
    node.remove();
    return { deleted: info, op: "delete-node" };
  },

  /* ---------------------------------------------------------------- *
   * group 2: style
   * ---------------------------------------------------------------- */

  /** Set a node's fill colour, or clear it with clear:true. */
  async "set-fill"({ id, color, fill, clear }) {
    const node = await getNode(id);
    if (!("fills" in node)) throw fail(`Node has no fills: ${id} (${node.type})`, "NO_FILL");
    if (clear === true) {
      node.fills = [];
      return { updated: nodeInfo(node), op: "set-fill" };
    }
    const spec = color !== undefined ? color : fill;
    if (spec === undefined) throw fail("set-fill needs a colour (hex/rgb) or clear:true", "BAD_PARAM");
    node.fills = [toPaint(spec)];
    return { updated: nodeInfo(node), op: "set-fill" };
  },

  /**
   * Set stroke colour and/or stroke weight, or clear strokes with clear:true.
   *
   * `clear` mirrors set-fill's existing `clear`, which is what makes it
   * possible to REMOVE a stroke at all. Without it a fill-only VECTOR keeps
   * Figma's default 1px black stroke, which drew a dark outline around the
   * trend-chart area (found by the Stage 3 audit).
   */
  async "set-stroke"({ id, color, stroke, width, strokeWeight, clear }) {
    const node = await getNode(id);
    if (!("strokes" in node)) throw fail(`Node has no strokes: ${id} (${node.type})`, "NO_STROKE");
    if (clear === true) {
      node.strokes = [];
      return { updated: nodeInfo(node), op: "set-stroke" };
    }
    const spec = color !== undefined ? color : stroke;
    const w = optNum(width !== undefined ? width : strokeWeight, "width");
    if (spec === undefined && w === undefined) {
      throw fail("set-stroke needs a colour, a width, or clear:true", "BAD_PARAM");
    }
    if (spec !== undefined) node.strokes = [toPaint(spec)];
    if (w !== undefined) {
      if (!("strokeWeight" in node)) throw fail(`Node has no stroke weight: ${id} (${node.type})`, "NO_STROKE_WEIGHT");
      node.strokeWeight = w;
    }
    return { updated: nodeInfo(node), op: "set-stroke" };
  },

  /** Set node opacity, 0..1. */
  async "set-opacity"({ id, opacity }) {
    const node = await getNode(id);
    if (!("opacity" in node)) throw fail(`Node has no opacity: ${id} (${node.type})`, "NO_OPACITY");
    const o = optNum(opacity, "opacity");
    if (o === undefined) throw fail("set-opacity needs opacity (0..1)", "BAD_PARAM");
    if (o < 0 || o > 1) throw fail(`opacity must be between 0 and 1, got ${o}`, "BAD_PARAM");
    node.opacity = o;
    return { updated: nodeInfo(node), op: "set-opacity" };
  },

  /** Round corners: one radius for all four, or four independent ones. */
  async "set-corner-radius"({ id, radius, topLeft, topRight, bottomLeft, bottomRight }) {
    const node = await getNode(id);
    if (!("cornerRadius" in node) && !("topLeftRadius" in node)) {
      throw fail(`Node does not support corner radius: ${id} (${node.type})`, "NO_CORNER_RADIUS");
    }
    const corners = [topLeft, topRight, bottomLeft, bottomRight];
    const hasCorners = corners.some((v) => v !== undefined && v !== null && v !== "");
    const r = optNum(radius, "radius");
    if (r === undefined && !hasCorners) {
      throw fail("set-corner-radius needs radius, or one of topLeft/topRight/bottomLeft/bottomRight", "BAD_PARAM");
    }
    if (r !== undefined) {
      node.cornerRadius = r;
      return { updated: nodeInfo(node), op: "set-corner-radius" };
    }
    if (!("topLeftRadius" in node)) {
      throw fail(`Node does not support per-corner radius: ${id} (${node.type})`, "NO_PER_CORNER_RADIUS");
    }
    if (topLeft !== undefined) node.topLeftRadius = num(topLeft, 0, "topLeft");
    if (topRight !== undefined) node.topRightRadius = num(topRight, 0, "topRight");
    if (bottomLeft !== undefined) node.bottomLeftRadius = num(bottomLeft, 0, "bottomLeft");
    if (bottomRight !== undefined) node.bottomRightRadius = num(bottomRight, 0, "bottomRight");
    return { updated: nodeInfo(node), op: "set-corner-radius" };
  },

  /* ---------------------------------------------------------------- *
   * group 3: text
   * ---------------------------------------------------------------- */

  /** Change the font family and/or style of a text node. */
  async "set-font"({ id, family, style }) {
    const node = await getNode(id);
    if (node.type !== "TEXT") throw fail(`Node is not a TEXT node: ${id} (${node.type})`, "NOT_A_TEXT_NODE");
    const current = node.fontName === figma.mixed ? null : node.fontName;
    const fam = family || (current && current.family);
    const sty = style || (current && current.style);
    if (!fam || !sty) {
      throw fail("set-font needs both family and style (this node mixes fonts)", "MIXED_FONT");
    }
    await figma.loadFontAsync({ family: fam, style: sty });
    node.fontName = { family: fam, style: sty };
    return { updated: nodeInfo(node), op: "set-font" };
  },

  /** Change the font size of a text node. */
  async "set-font-size"({ id, size }) {
    const node = await getNode(id);
    await ensureFontLoaded(node);
    const px = optNum(size, "size");
    if (px === undefined) throw fail("set-font-size needs size", "BAD_PARAM");
    if (px <= 0) throw fail(`Font size must be positive, got ${px}`, "BAD_PARAM");
    node.fontSize = px;
    return { updated: nodeInfo(node), op: "set-font-size" };
  },

  /** Change font weight (100..900), optionally italic, keeping the family. */
  async "set-font-weight"({ id, weight, italic }) {
    const node = await getNode(id);
    const fn = await ensureFontLoaded(node);
    if (weight === undefined || weight === null || weight === "") {
      throw fail("set-font-weight needs weight (100..900)", "BAD_PARAM");
    }
    const w = num(weight, 400, "weight");
    const style = await resolveStyleName(fn.family, w, italic === true);
    node.fontName = { family: fn.family, style };
    return { updated: nodeInfo(node), op: "set-font-weight" };
  },

  /** Set the colour of a text node's glyphs. */
  async "set-text-color"({ id, color, fill }) {
    const node = await getNode(id);
    if (node.type !== "TEXT") throw fail(`Node is not a TEXT node: ${id} (${node.type})`, "NOT_A_TEXT_NODE");
    const spec = color !== undefined ? color : fill;
    if (spec === undefined) throw fail("set-text-color needs a colour (hex/rgb)", "BAD_PARAM");
    node.fills = [toPaint(spec)];
    return { updated: nodeInfo(node), op: "set-text-color" };
  },

  /** Replace the characters of a text node. */
  async "set-text-content"({ id, characters, text }) {
    const node = await getNode(id);
    const content = characters !== undefined ? characters : text;
    if (typeof content !== "string") throw fail("set-text-content needs characters/text", "BAD_PARAM");
    await ensureFontLoaded(node);
    node.characters = content;
    return { updated: nodeInfo(node), op: "set-text-content" };
  },

  /* ---------------------------------------------------------------- *
   * group 4: auto layout
   * ---------------------------------------------------------------- */

  /** Turn auto layout on/off, optionally setting spacing and padding too. */
  async "set-auto-layout"({ id, mode, spacing, padding, primaryAxisSizingMode, counterAxisSizingMode }) {
    const node = await getNode(id);
    if (!("layoutMode" in node)) {
      throw fail(`Node does not support auto layout: ${id} (${node.type})`, "NO_AUTO_LAYOUT");
    }
    if (mode === undefined || mode === null || mode === "") {
      throw fail("set-auto-layout needs mode: horizontal | vertical | none", "BAD_PARAM");
    }
    const MODES = {
      HORIZONTAL: "HORIZONTAL", HORIZ: "HORIZONTAL", ROW: "HORIZONTAL",
      VERTICAL: "VERTICAL", VERT: "VERTICAL", COLUMN: "VERTICAL",
      NONE: "NONE", OFF: "NONE",
    };
    const layoutMode = MODES[String(mode).trim().toUpperCase()];
    if (!layoutMode) {
      throw fail(`Unknown mode "${mode}". Use horizontal | vertical | none`, "BAD_PARAM");
    }
    node.layoutMode = layoutMode;
    if (layoutMode === "NONE") return { updated: nodeInfo(node), op: "set-auto-layout" };

    const sp = optNum(spacing, "spacing");
    if (sp !== undefined) node.itemSpacing = sp;

    const pad = optNum(padding, "padding");
    if (pad !== undefined) {
      node.paddingTop = pad;
      node.paddingRight = pad;
      node.paddingBottom = pad;
      node.paddingLeft = pad;
    }

    for (const [key, value] of [["primaryAxisSizingMode", primaryAxisSizingMode], ["counterAxisSizingMode", counterAxisSizingMode]]) {
      if (value === undefined || value === null || value === "") continue;
      const v = String(value).trim().toUpperCase();
      if (v !== "FIXED" && v !== "AUTO") {
        throw fail(`${key} must be FIXED or AUTO, got "${value}"`, "BAD_PARAM");
      }
      node[key] = v;
    }

    return { updated: nodeInfo(node), op: "set-auto-layout" };
  },

  /** Set padding: uniform, per axis, or per side (later args win). */
  async "set-padding"({ id, all, top, right, bottom, left, horizontal, vertical }) {
    const node = requireAutoLayout(await getNode(id), "set-padding");
    const a = optNum(all, "all");
    const h = optNum(horizontal, "horizontal");
    const v = optNum(vertical, "vertical");
    const t = optNum(top, "top");
    const r = optNum(right, "right");
    const b = optNum(bottom, "bottom");
    const l = optNum(left, "left");
    if ([a, h, v, t, r, b, l].every((x) => x === undefined)) {
      throw fail("set-padding needs all, horizontal/vertical, or top/right/bottom/left", "BAD_PARAM");
    }
    const before = { top: node.paddingTop, right: node.paddingRight, bottom: node.paddingBottom, left: node.paddingLeft };
    if (a !== undefined) {
      node.paddingTop = a; node.paddingRight = a; node.paddingBottom = a; node.paddingLeft = a;
    }
    if (h !== undefined) { node.paddingLeft = h; node.paddingRight = h; }
    if (v !== undefined) { node.paddingTop = v; node.paddingBottom = v; }
    if (t !== undefined) node.paddingTop = t;
    if (r !== undefined) node.paddingRight = r;
    if (b !== undefined) node.paddingBottom = b;
    if (l !== undefined) node.paddingLeft = l;
    return { updated: nodeInfo(node), previousPadding: before, op: "set-padding" };
  },

  /** Distance between items along the layout's primary axis. */
  async "set-item-spacing"({ id, spacing }) {
    const node = requireAutoLayout(await getNode(id), "set-item-spacing");
    const sp = optNum(spacing, "spacing");
    if (sp === undefined) throw fail("set-item-spacing needs spacing", "BAD_PARAM");
    node.itemSpacing = sp;
    return { updated: nodeInfo(node), op: "set-item-spacing" };
  },

  /** Align children along the primary axis. */
  async "set-primary-axis-align"({ id, align }) {
    const node = requireAutoLayout(await getNode(id), "set-primary-axis-align");
    node.primaryAxisAlignItems = normAlign(align, ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"], "set-primary-axis-align");
    return { updated: nodeInfo(node), op: "set-primary-axis-align" };
  },

  /** Align children along the counter axis. */
  async "set-counter-axis-align"({ id, align }) {
    const node = requireAutoLayout(await getNode(id), "set-counter-axis-align");
    node.counterAxisAlignItems = normAlign(align, ["MIN", "CENTER", "MAX", "BASELINE"], "set-counter-axis-align");
    return { updated: nodeInfo(node), op: "set-counter-axis-align" };
  },

  /* ---------------------------------------------------------------- *
   * group 5: structure
   * ---------------------------------------------------------------- */

  /** Move an existing node under a different parent. */
  async "append-child"({ parentId, childId, id, child }) {
    if (!parentId) throw fail("append-child needs parentId", "BAD_PARAM");
    const parent = await resolveParent(parentId);
    const ref = childId !== undefined ? childId : (child !== undefined ? child : id);
    const node = await getNode(ref, "childId");
    if (node.id === parent.id) throw fail("Cannot append a node to itself", "BAD_PARAM");
    parent.appendChild(node);
    return { updated: nodeInfo(node), parentId: parent.id, op: "append-child" };
  },

  /**
   * Convert an existing node into a COMPONENT (figma.createComponentFromNode).
   * The source node is consumed; the returned component is a new node.
   */
  async "create-component"({ id, nodeId, from, name }) {
    const ref = id !== undefined ? id : (nodeId !== undefined ? nodeId : from);
    const source = await getNode(ref);
    if (typeof figma.createComponentFromNode !== "function") {
      throw fail("This Figma version has no figma.createComponentFromNode", "UNSUPPORTED_API");
    }
    if (source.type === "COMPONENT") {
      throw fail(`Node ${source.id} is already a COMPONENT`, "ALREADY_COMPONENT");
    }
    const component = figma.createComponentFromNode(source);
    if (name) component.name = name;
    return { created: nodeInfo(component), sourceId: source.id, op: "create-component" };
  },

  /** Instantiate a COMPONENT somewhere on the canvas. */
  async "create-instance"({ componentId, id, x, y, parentId }) {
    const ref = componentId !== undefined ? componentId : id;
    const comp = await getNode(ref, "componentId");
    if (comp.type !== "COMPONENT") {
      throw fail(`Node is not a COMPONENT: ${comp.id} (${comp.type})`, "NOT_A_COMPONENT");
    }
    const instance = comp.createInstance();
    if (parentId) {
      const parent = await resolveParent(parentId);
      parent.appendChild(instance);
    }
    const nx = optNum(x, "x");
    const ny = optNum(y, "y");
    if (nx !== undefined) instance.x = nx;
    if (ny !== undefined) instance.y = ny;
    figma.currentPage.selection = [instance];
    return { created: nodeInfo(instance), componentId: comp.id, op: "create-instance" };
  },

  /* ---------------------------------------------------------------- *
   * group 6: effects / text alignment / sizing
   * ---------------------------------------------------------------- */

  /**
   * Drop shadow, inner shadow or blur. A soft card shadow is what separates a
   * premium light-mode UI from a flat one, and BACKGROUND_BLUR is the only way
   * to write a frosted-glass surface - there is no other op for either.
   *
   * Accepts a `shadow` shorthand, a raw `effects` array, `blur`, or clear:true.
   *
   * Field shape is type-dependent ON PURPOSE. Figma validates the effect object
   * strictly and rejects the WHOLE assignment on any unknown key, so a
   * LAYER_BLUR carrying a `color` fails with:
   *   "Unrecognized key(s) in object: 'color'"
   * That single field used to kill every glassmorphism build at its third op,
   * because the flagship surface of a premium UI is exactly where a
   * BACKGROUND_BLUR gets written. Shadow types therefore get
   * color/offset/radius/spread/blendMode; blur types get type/radius/visible
   * and nothing else.
   */
  async "set-effects"({ id, shadow, effects, blur, clear }) {
    const node = await getNode(id);
    if (!("effects" in node)) throw fail(`Node has no effects: ${id} (${node.type})`, "NO_EFFECTS");

    if (clear === true) {
      node.effects = [];
      return { updated: nodeInfo(node, { depth: 0 }), op: "set-effects" };
    }

    if (Array.isArray(effects)) {
      node.effects = effects.map((raw, i) => {
        const e = raw || {};
        const type = normEnum(e.type, ["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"], `effects[${i}].type`);
        const eff = { type, visible: e.visible !== false };
        if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
          const paint = toPaint(e.color !== undefined ? e.color : "#000000");
          const alpha = e.opacity !== undefined ? num(e.opacity, 0.08, "opacity")
            : (paint.opacity !== undefined ? paint.opacity : 1);
          eff.color = { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: Math.max(0, Math.min(1, alpha)) };
          eff.offset = { x: num(e.x, 0, "x"), y: num(e.y, 1, "y") };
          eff.radius = num(e.blur !== undefined ? e.blur : e.radius, 2, "blur");
          eff.spread = num(e.spread, 0, "spread");
          eff.blendMode = "NORMAL";
        } else {
          eff.radius = num(e.blur !== undefined ? e.blur : e.radius, 4, "blur");
        }
        return eff;
      });
      return { updated: nodeInfo(node, { depth: 0 }), op: "set-effects" };
    }

    const spec = shadow && typeof shadow === "object" ? shadow : {};
    const hasShadow = Object.keys(spec).length > 0;
    const blurRadius = optNum(blur, "blur");
    if (!hasShadow && blurRadius === undefined) {
      throw fail("set-effects needs `shadow`, `effects`, `blur`, or clear:true", "BAD_PARAM");
    }

    const list = [];
    if (hasShadow) {
      const paint = toPaint(spec.color !== undefined ? spec.color : "#000000");
      const alpha = spec.opacity !== undefined
        ? num(spec.opacity, 0.08, "opacity")
        : (paint.opacity !== undefined ? paint.opacity : 0.08);
      list.push({
        type: "DROP_SHADOW",
        color: { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: Math.max(0, Math.min(1, alpha)) },
        offset: { x: num(spec.x, 0, "x"), y: num(spec.y, 1, "y") },
        radius: num(spec.blur, 2, "blur"),
        spread: num(spec.spread, 0, "spread"),
        visible: true,
        blendMode: "NORMAL",
      });
    }
    if (blurRadius !== undefined) {
      list.push({ type: "LAYER_BLUR", radius: blurRadius, visible: true });
    }
    node.effects = list;
    return { updated: nodeInfo(node, { depth: 0 }), op: "set-effects" };
  },

  /** Align text inside its own box - a data table needs right-aligned numbers. */
  async "set-text-align"({ id, horizontal, vertical }) {
    const node = await getNode(id);
    if (node.type !== "TEXT") throw fail(`Node is not a TEXT node: ${id} (${node.type})`, "NOT_A_TEXT_NODE");
    if (horizontal === undefined && vertical === undefined) {
      throw fail("set-text-align needs horizontal and/or vertical", "BAD_PARAM");
    }
    if (horizontal !== undefined) {
      node.textAlignHorizontal = normEnum(horizontal, ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"], "textAlignHorizontal");
    }
    if (vertical !== undefined) {
      node.textAlignVertical = normEnum(vertical, ["TOP", "CENTER", "BOTTOM"], "textAlignVertical");
    }
    return { updated: nodeInfo(node, { depth: 0 }), op: "set-text-align" };
  },

  /**
   * Text auto-sizing. HEIGHT means "wrap at my fixed width, grow downwards" -
   * what keeps a real layout from clipping a wrapping label.
   */
  async "set-text-autoresize"({ id, mode, width, height }) {
    const node = await getNode(id);
    if (node.type !== "TEXT") throw fail(`Node is not a TEXT node: ${id} (${node.type})`, "NOT_A_TEXT_NODE");
    const m = normAutoResize(mode);
    const w = optNum(width, "width");
    const h = optNum(height, "height");
    node.textAutoResize = m;
    if (w !== undefined || h !== undefined) {
      await ensureFontLoaded(node);
      node.resize(w === undefined ? node.width : w, h === undefined ? node.height : h);
    }
    return { updated: nodeInfo(node, { depth: 0 }), op: "set-text-autoresize" };
  },

  /**
   * How this node is sized by its parent's auto layout:
   *   FIXED = keep my size, HUG = shrink-wrap my content, FILL = stretch.
   * This is what makes a bulk-built page correct instead of pixel-guessed.
   */
  async "set-layout-sizing"({ id, horizontal, vertical }) {
    const node = await getNode(id);
    if (!("layoutSizingHorizontal" in node)) {
      throw fail(`Node does not support layout sizing: ${id} (${node.type})`, "NO_LAYOUT_SIZING");
    }
    if (horizontal === undefined && vertical === undefined) {
      throw fail("set-layout-sizing needs horizontal and/or vertical", "BAD_PARAM");
    }
    const asked = [horizontal, vertical].filter((v) => v !== undefined).map((v) => String(v).trim().toUpperCase());
    const wantsGrow = asked.some((v) => v === "HUG" || v === "FILL");
    const wantsFill = asked.includes("FILL");
    if (wantsGrow && "layoutMode" in node && node.layoutMode === "NONE") {
      throw fail(`${id}: HUG/FILL needs auto layout on this node - run set-auto-layout first`, "NO_AUTO_LAYOUT");
    }
    if (wantsFill && !isAutoLayoutContainer(node.parent)) {
      throw fail(`${id}: FILL needs an auto-layout parent to fill into`, "NO_AUTO_LAYOUT_PARENT");
    }
    if (horizontal !== undefined) {
      node.layoutSizingHorizontal = normEnum(horizontal, ["FIXED", "HUG", "FILL"], "layoutSizingHorizontal");
    }
    if (vertical !== undefined) {
      node.layoutSizingVertical = normEnum(vertical, ["FIXED", "HUG", "FILL"], "layoutSizingVertical");
    }
    return { updated: nodeInfo(node, { depth: 0 }), op: "set-layout-sizing" };
  },

  /** Sequential batch. Fails fast and reports which step failed. */
  async run({ ops }) {
    if (!Array.isArray(ops) || ops.length === 0) {
      throw fail("`run` requires a non-empty `ops` array", "BAD_PARAM");
    }
    const results = [];
    let lastCreatedId = null;
    // Names declared with `as` inside this batch, so a later step can point at
    // an earlier step's node with "$name". "@last" only ever reaches one step
    // back, which is not enough to assemble a real page: a card needs to be
    // styled and have children appended long after it was created.
    const named = {};
    for (let i = 0; i < ops.length; i++) {
      const step = ops[i] || {};
      const op = step.op;
      if (!handlers[op] || op === "run") {
        throw fail(`Step ${i}: unsupported op "${op}"`, "UNSUPPORTED_OP");
      }
      // "@last" = whatever the previous step created.
      // "$name"  = whatever an earlier step declared with `as: "name"`.
      // Both work in any node-reference field, so a batch can chain
      // create -> style -> nest without the caller tracking ids by hand.
      const params = Object.assign({}, step.params || {});
      for (const key of Object.keys(params)) {
        const value = params[key];
        if (value !== "@last" && !(typeof value === "string" && value.startsWith("$"))) continue;
        if (!ID_KEYS.includes(key)) {
          throw fail(`Step ${i}: "${value}" is only valid in node-reference params (${ID_KEYS.join(", ")}), not "${key}"`, "BAD_PARAM");
        }
        if (value === "@last") {
          if (!lastCreatedId) throw fail(`Step ${i}: "${key}":"@last" but no earlier step created a node`, "BAD_PARAM");
          params[key] = lastCreatedId;
        } else {
          const refName = value.slice(1);
          const target = named[refName];
          if (!target) {
            throw fail(`Step ${i}: unknown batch reference "${value}" - no earlier step declared as: "${refName}"`, "BAD_PARAM");
          }
          params[key] = target;
        }
      }
      try {
        const data = await handlers[op](params);
        if (data && data.created && data.created.id) {
          lastCreatedId = data.created.id;
          if (typeof step.as === "string" && step.as) named[step.as] = data.created.id;
        }
        results.push({ step: i, op, ok: true, data });
      } catch (e) {
        const err = new Error(`Step ${i} ("${op}") failed: ${e && e.message ? e.message : String(e)}`);
        err.code = e && e.code ? e.code : "STEP_FAILED";
        err.partial = results;
        throw err;
      }
    }
    return { ops: results, count: results.length };
  },

  /** Export a node as base64 PNG/SVG for QA evidence (Stage 9.2-C; format param (SVG support), default PNG backward-compatible). */
  async "export-node"({ id, scale, format }) {
    if (!id) throw fail("Missing required param: id", "BAD_PARAM");
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw fail(`Node not found: ${id}`, "NODE_NOT_FOUND");
    if (typeof node.exportAsync !== "function") throw fail(`Node type cannot be exported: ${node.type}`, "BAD_NODE");
    const s = num(scale, 1, "scale");
    if (format === "SVG") {
      /* v4 根因修正：本 API 版本的 exportAsync({format:"SVG"}) 返回 UTF-8 字节数组而非 string，
        String() 强转会得到 "60,115,..." 逗号十进制码（v1/v2/v3 三个版本全部栽在这里）。
        沙箱无 TextDecoder —— 手工 UTF-8 解码（codePoint 支持增补平面）。 */
      let svg = await node.exportAsync({ format: "SVG" });
      if (typeof svg !== "string") {
        const b = svg;
        let out = "";
        for (let i = 0; i < b.length; ) {
          const c = b[i];
          if (c < 0x80) { out += String.fromCharCode(c); i += 1; }
          else if (c < 0xe0) { out += String.fromCharCode(((c & 31) << 6) | (b[i + 1] & 63)); i += 2; }
          else if (c < 0xf0) { out += String.fromCharCode(((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; }
          else { out += String.fromCodePoint(((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63)); i += 4; }
        }
        svg = out;
      }
      const text = String(svg);
      return { op: "export-node", id: node.id, name: node.name, format: "SVG", v: 4, bytes: text.length, svg: text };
    }
    const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: s } });
    const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let b64 = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
      b64 += CHARS[b1 >> 2] + CHARS[((b1 & 3) << 4) | (b2 === undefined ? 0 : b2 >> 4)];
      b64 += b2 === undefined ? "=" : CHARS[((b2 & 15) << 2) | (b3 === undefined ? 0 : b3 >> 6)];
      b64 += b3 === undefined ? "=" : CHARS[b3 & 63];
    }
    return { op: "export-node", id: node.id, name: node.name, format: "PNG", scale: s, bytes: bytes.length, base64: b64 };
  },

  /**
   * F2 · 图片填充：把节点 fills 换成一张 IMAGE paint。
   * `asset` = Bridge asset 目录（.vibe/assets/）里的纯文件名；字节经 UI 同域
   * fetch 拿回（见 fetchAssetBytes）。scaleMode 缺省 FILL。opacity 可选。
   * 严格校验 asset 形状 —— 与 Bridge /v1/asset 同规则，双端防线。
   */
  async "set-image-fill"({ id, asset, scaleMode, opacity }) {
    if (!asset || typeof asset !== "string" || !path_basename(asset) || asset.includes(".."))
      throw fail("set-image-fill needs `asset`: a bare file name present in the Bridge asset dir (.vibe/assets/)", "BAD_PARAM");
    const MODES = ["FILL", "FIT", "CROP", "TILE"];
    const mode = scaleMode === undefined ? "FILL" : scaleMode;
    if (!MODES.includes(mode)) throw fail(`scaleMode must be one of ${MODES.join(" / ")}`, "BAD_PARAM");
    const node = await getNode(id);
    if (!("fills" in node)) throw fail(`Node has no fills: ${node.id} (${node.type})`, "NO_FILL");

    const bytes = await fetchAssetBytes(asset);
    if (!bytes || bytes.length === 0) throw fail(`Asset is empty: ${asset}`, "BAD_ASSET");
    const image = figma.createImage(bytes);
    if (!image || !image.hash) throw fail(`createImage failed for ${asset}`, "BAD_ASSET");

    const paint = { type: "IMAGE", scaleMode: mode, imageHash: image.hash };
    if (opacity !== undefined) paint.opacity = Math.max(0, Math.min(1, num(opacity, 1, "opacity")));
    node.fills = [paint];
    return {
      updated: nodeInfo(node, { depth: 0 }),
      op: "set-image-fill", asset, imageHash: image.hash, scaleMode: mode,
    };
  },
};

/** 纯文件名判定（插件侧无 path 模块 —— 与 Bridge /v1/asset 的校验同规则） */
function path_basename(name) {
  return name && !name.includes("/") && !name.includes("\\");
}

const OP_NAMES = Object.keys(handlers).filter((k) => k !== "run");

async function execute(op, params) {
  if (!op || typeof op !== "string") throw fail("Missing `op`", "BAD_OP");
  const handler = handlers[op];
  if (!handler) {
    throw fail(`Unsupported op "${op}". Supported: ${OP_NAMES.join(", ")}, run`, "UNSUPPORTED_OP");
  }
  return handler(params || {});
}

/* ------------------------------------------------------------------ */
/* message bridge                                                      */
/* ------------------------------------------------------------------ */

figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "vibe:hello") {
    figma.ui.postMessage({
      type: "vibe:ready",
      page: figma.currentPage.name,
      pageId: figma.currentPage.id,
      ops: OP_NAMES,
    });
    return;
  }

  if (msg.type === "vibe:asset-bytes") {
    const pending = pendingAssetFetches.get(msg.reqId);
    if (!pending) return; // 超时已被清掉的迟到应答：静默丢弃，不许误配对
    pendingAssetFetches.delete(msg.reqId);
    if (msg.ok) pending.resolve(figma.base64Decode(msg.base64 || ""));
    else pending.reject(fail(msg.error || "UI 取图失败", msg.code || "ASSET_FETCH_FAILED"));
    return;
  }

  if (msg.type !== "vibe:exec") return;

  const { id, op, params } = msg;
  try {
    const data = await execute(op, params);
    figma.ui.postMessage({ type: "vibe:result", id, ok: true, data });
  } catch (e) {
    figma.ui.postMessage({
      type: "vibe:result",
      id,
      ok: false,
      error: {
        message: e && e.message ? e.message : String(e),
        code: (e && e.code) || "EXEC_ERROR",
        partial: e && e.partial ? e.partial : undefined,
      },
    });
  }
};

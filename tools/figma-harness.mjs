#!/usr/bin/env node
/**
 * figma-harness.mjs — 离线加载真实 `figma-plugin/code.js` 的共享装置
 *
 * 用 vm 跑**一字未改**的插件源码，只注入一个受控的 `figma` 桩，然后把内部的
 * `handlers` / `execute` / `nodeInfo` / `OP_NAMES` 取出来。零依赖。
 *
 * 为什么抽成共享模块：`EFFECT_KEYS`（Figma 对效果对象的真实 key 白名单）是
 * **安全关键常量**——它多一个 key 会让 BACKGROUND_BLUR（毛玻璃唯一实现路径）整条被拒。
 * 这份白名单原来只存在于 `qa-plugin.mjs`，而 `precheck.mjs` 需要同一份。
 * 粘贴第二份 = 将来必然腐坏成两份不一致，所以收成单一事实源。
 *
 * 桩的两条设计原则：
 *   1. **严格照抄宿主的校验规则**，而不是只照抄形状——`effects` 的 setter 会像
 *      Figma 一样对未知 key 抛错。宽容的桩测不出真实约束。
 *   2. **覆盖面按源码枚举**——宿主 API 面从 `code.js` 里实际用到的成员反推
 *      （8 个 `figma.*` 工厂 + 40 余个节点成员），不是凭空猜。若将来 `code.js`
 *      用了桩里没有的 API，会抛 TypeError；调用方应把它归类为**装置缺口**
 *      而不是产品缺陷（见 `precheck.mjs` 的错误分类）。
 *
 * 用法：
 *   import { loadPlugin, EFFECT_KEYS } from "./figma-harness.mjs";
 *   const { handlers, execute, opNames, nodeInfo, makeNode, register } = loadPlugin();
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN_SRC = path.join(ROOT, "figma-plugin", "code.js");

/** Figma 对四类效果的 key 白名单（多写一个 key 就整条赋值被拒）——这是**输出侧**的契约 */
export const EFFECT_KEYS = {
  DROP_SHADOW: ["type", "color", "offset", "radius", "spread", "visible", "blendMode"],
  INNER_SHADOW: ["type", "color", "offset", "radius", "spread", "visible", "blendMode"],
  LAYER_BLUR: ["type", "radius", "visible"],
  BACKGROUND_BLUR: ["type", "radius", "visible"],
};

/**
 * `set-effects` **读取**哪些输入字段（这是**输入侧**的契约，与上面的输出侧白名单配套）。
 *
 * 为什么必须单独声明：`set-effects` 会把输入**归一化**——它按类型构造 `eff`，
 * 不认识的输入字段**静默丢弃，不报错**。所以「给 BACKGROUND_BLUR 写了 color」这种错
 * 跑一万遍也跑不出来（既不报错也不生效，画面只是比预期朴素）。
 * 它跑不出来，就只能在这里拦；而拦的依据必须与 `code.js` 里的读取清单一致。
 * 对应源码：`figma-plugin/code.js` 的 `set-effects`（分支里逐字段 `num()/toPaint()` 的那段）。
 */
export const EFFECT_INPUT_KEYS = {
  DROP_SHADOW: ["type", "color", "opacity", "x", "y", "blur", "radius", "spread", "visible"],
  INNER_SHADOW: ["type", "color", "opacity", "x", "y", "blur", "radius", "spread", "visible"],
  LAYER_BLUR: ["type", "blur", "radius", "visible"],
  BACKGROUND_BLUR: ["type", "blur", "radius", "visible"],
};

/** 会抛 NODE_NOT_FOUND 的宿主 API 文案（照抄 Figma 原文，便于一眼认亲） */
export const DYNAMIC_PAGE_ERROR = "Cannot call with documentAccess: dynamic-page";

/** 节点上可读写的标量属性（从 code.js 实际访问面枚举而来） */
/**
 * 节点属性必须**按类型**给，不能给所有节点塞同一套。
 *
 * 这条是踩出来的：`code.js` 的 `set-layout-sizing` 里有一句
 *   if (wantsGrow && "layoutMode" in node && node.layoutMode === "NONE") throw ...
 * 真实 Figma 里 TEXT / RECTANGLE **没有** `layoutMode`（它是 AutoLayoutMixin 的属性，
 * 只有 FRAME / COMPONENT / COMPONENT_SET / INSTANCE 才实现），所以对文字节点这句根本不进。
 * 桩图省事地给所有节点都补上 `layoutMode: "NONE"`，就会把合法的 FILL 判成违规——
 * **凭空造出一批真实运行不会发生的"契约错误"**。
 * 结论：桩「多给属性」和「少给属性」一样危险，形状要照 mixin 划分来。
 */
const ALL_SCENE = {
  opacity: 1,
  rotation: 0,
  layoutSizingHorizontal: "FIXED",
  layoutSizingVertical: "FIXED",
  strokeWeight: 1,
};

/** 仅自动布局容器 */
const AUTOLAYOUT = {
  layoutMode: "NONE",
  itemSpacing: 0,
  paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0,
  primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "AUTO",
  primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN",
  clipsContent: false,
};

/** 仅 TEXT */
const TEXT_PROPS = {
  characters: "",
  fontSize: 12,
  fontName: { family: "Inter", style: "Regular" },
  textAutoResize: "NONE",
  textAlignHorizontal: "LEFT",
  textAlignVertical: "TOP",
  // FR-3/FR-4 · 与真实 API 同形（unit=PIXELS|PERCENT|AUTO）；混排时真实宿主为 figma.mixed
  lineHeight: { value: 100, unit: "PERCENT" },
  letterSpacing: { value: 0, unit: "PERCENT" },
};

/** 仅带圆角能力的形状 */
const CORNER = {
  cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0,
  bottomLeftRadius: 0, bottomRightRadius: 0,
};

/** 类型 → 它真正拥有的能力（对齐 Figma 的 mixin 划分） */
const CAPS = {
  FRAME: { auto: true, corner: true },
  COMPONENT: { auto: true, corner: true, instance: true },
  COMPONENT_SET: { auto: true, corner: true },
  INSTANCE: { auto: true, corner: true },
  RECTANGLE: { corner: true },
  TEXT: { text: true },
  VECTOR: {},
  LINE: {},
  ELLIPSE: {},
  PAGE: {},
};

let NODE_SEQ = 0;

/**
 * 造一个"像 Figma 节点一样够用"的桩节点。
 * `effects` 是唯一严格校验的入口——它正是 1.1 那次 P0 的现场。
 */
export function makeNode(type, props = {}, ctx = null) {
  const caps = CAPS[type] || {};
  const node = {
    id: props.id || `${type.toLowerCase().replace(/[^a-z]/g, "")}:${++NODE_SEQ}`,
    name: props.name || type,
    type,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    parent: null,
    children: [],
    fills: [],
    strokes: [],
    ...ALL_SCENE,
    ...(caps.auto ? AUTOLAYOUT : {}),
    ...(caps.text ? TEXT_PROPS : {}),
    ...(caps.corner ? CORNER : {}),
    ...(caps.vector ? { vectorPaths: [] } : {}),
    ...props,
  };

  Object.defineProperty(node, "effects", {
    enumerable: true,
    get: () => node.__effects,
    set(v) {
      for (const e of v) {
        const allowed = EFFECT_KEYS[e.type];
        if (!allowed) throw new Error(`Unknown effect type: ${e.type}`);
        const bad = Object.keys(e).filter((k) => !allowed.includes(k));
        if (bad.length) {
          throw new Error(`Unrecognized key(s) in object: ${bad.map((b) => `'${b}'`).join(", ")}`);
        }
      }
      node.__effects = v;
    },
  });
  node.__effects = [];

  node.appendChild = (child) => {
    node.children.push(child);
    if (child && typeof child === "object") child.parent = node;
    return child;
  };
  node.resize = (w, h) => {
    node.width = w;
    node.height = h;
  };
  node.remove = () => {
    const p = node.parent;
    if (p && Array.isArray(p.children)) p.children = p.children.filter((c) => c !== node);
    if (ctx && ctx.nodes) ctx.nodes.delete(node.id);
  };
  node.clone = () => ctx ? ctx.spawn(type, { name: node.name }) : makeNode(type, { name: node.name }, ctx);
  // createInstance 只长在 COMPONENT 上（真实 API 亦然），instance 指的是"实例化能力"
  if (caps.instance) {
    node.createInstance = () => (ctx ? ctx.spawn("INSTANCE", { name: `${node.name} instance` }) : makeNode("INSTANCE", {}, ctx));
  }
  // duplicate() 在真实 Figma Plugin API 里**不存在**（是 clone()）。不提供它，
  // 让"凭印象写成 duplicate"当场炸出来，而不是静默通过。
  node.exportAsync = async (opts) =>
    opts && opts.format === "SVG" ? "<svg></svg>" : new Uint8Array([1, 2, 3]);

  Object.defineProperty(node, "childCount", { enumerable: true, get: () => node.children.length });
  // props.children 是"构造时就带着子树"的便利写法，把 parent 反向连好。
  // 注意必须先把 children 清空再 link——spread 已经把它指到 props.children 上了，
  // 直接往里 push 会变成自引用数组（RangeError: Invalid array length）。
  if (Array.isArray(props.children)) {
    node.children = [];
    link(node, props.children);
  }
  return node;
}

/** 让 children 与 parent 双向一致（桩层面的便利构造） */
function link(parent, children) {
  parent.children = parent.children || [];
  for (const c of children) {
    parent.children.push(c);
    c.parent = parent;
  }
  return parent;
}

/**
 * 加载插件源码。
 * @param {{autoVivify?: boolean}} [opts]
 *   autoVivify=true 时，`getNodeByIdAsync` 对**任何** id 都返回一个节点（不存在就现造），
 *   并把该 id 记进 `stats.autoVivified`。用途：跑一份构建计划时，计划里引用的
 *   "画布上已有节点"不该让试点当场失败——离线装置无法判断它们是否存在，
 *   这个判断属于在线核对（见 precheck `--live`）。
 */
export function loadPlugin(opts = {}) {
  const { autoVivify = false } = opts;
  const src = fs.readFileSync(PLUGIN_SRC, "utf8");
  const nodes = new Map();
  const stats = { autoVivified: [], spawned: [] };
  /**
   * 外部引用的类型提示：id → 该 id 被期望的节点类型。
   * 离线装置查不出画布上到底有没有这个节点，**更不该顺带判它是什么类型**。
   * 若不提示，`create-instance({componentId:"1024:33"})` 会拿一个默认 FRAME 撞上
   * `NOT_A_COMPONENT` —— 那是装置凭空造出来的错，不是计划的问题。
   */
  const hints = new Map();

  const ctx = {
    nodes,
    spawn(type, props = {}) {
      const n = makeNode(type, props, ctx);
      nodes.set(n.id, n);
      stats.spawned.push(n.id);
      return n;
    },
  };

  const page = link(makeNode("PAGE", { id: "page:1", name: "Page 1" }, ctx), []);
  let imageSeq = 0; // F2 · createImage 桩的确定性 hash 序号
  // PageNode 在真实 API 上带 `selection`，而 `code.js` 的 `get-node`（写 `info.selection`）
  // 与 `get-page-summary`（读 `currentPage.selection`）都真的会碰它。桩少了这个成员，
  // 会让**任何**走 get-node 的离线装置抛 `TypeError: ... reading 'map'` —— 那是装置缺口
  // 被当成产品缺陷报出去，正是本文件头部第 2 条原则要避免的形态。
  page.selection = [];
  nodes.set(page.id, page);

  const figmaStub = {
    showUI() {},
    ui: {
      onmessage: null,
      /* F2 · set-image-fill 的 UI 往返桩：主线程 postMessage(vibe:fetch-asset) 后，
         真 UI 会 fetch Bridge /v1/asset 再回 base64；离线装置模拟这一应答——
         回一个合法形态的 base64（内容不真实，但让链路走通、hash 确定性）。 */
      postMessage(msg) {
        if (msg && msg.type === "vibe:fetch-asset") {
          setTimeout(() => {
            figmaStub.ui.onmessage?.({ type: "vibe:asset-bytes", reqId: msg.reqId, ok: true, base64: "aGVsbG8taW1hZ2U=" });
          }, 0);
        }
      },
    },
    currentPage: page,
    fileKey: "harness-file-key", // FR-1 · ping 回传 fileKey；离线桩给确定性值
    viewport: { scrollAndZoomIntoView() {} },
    editorType: "figma",
    mixed: Symbol("figma.mixed"),
    async getNodeByIdAsync(id) {
      if (nodes.has(id)) return nodes.get(id);
      if (!autoVivify) return null;
      stats.autoVivified.push(id);
      const t = hints.get(id) || "FRAME";
      return ctx.spawn(t, { id, name: id });
    },
    // 同步版本在 documentAccess:"dynamic-page" 下是被禁的——桩如实复刻这个约束，
    // 否则"用回同步 API"这类退化改动会被静默放过。
    getNodeById() {
      throw new Error(DYNAMIC_PAGE_ERROR);
    },
    async loadFontAsync() {},
    createFrame: () => ctx.spawn("FRAME"),
    createRectangle: () => ctx.spawn("RECTANGLE"),
    createEllipse: () => ctx.spawn("ELLIPSE"),
    createLine: () => ctx.spawn("LINE"),
    createText: () => ctx.spawn("TEXT"),
    createVector: () => ctx.spawn("VECTOR"),
    createComponentFromNode: (n) => ctx.spawn("COMPONENT", { name: n ? n.name : "Component" }),
    /* F2 · 图片桩：createImage 不真解码，给确定性 hash（按序 IMGSEQ）；
       base64Decode 与真 API 同签名（长度校验而非真解码——离线装置不验图片内容） */
    createImage: (bytes) => {
      if (!bytes || !bytes.length) throw new Error("createImage: empty bytes");
      return { hash: `stub-img:${++imageSeq}` };
    },
    base64Decode: (s) => {
      if (typeof s !== "string") throw new Error("base64Decode: not a string");
      return new Uint8Array(s.length * 3 || 8);
    },
  };

  const vmCtx = vm.createContext({
    figma: figmaStub,
    __html__: "<html></html>",
    console,
    /* F2 · set-image-fill 的 UI 往返用 setTimeout 做超时 —— 真插件沙箱里有它，
       离线装置此前没暴露过（没有任何 op 用过定时器），这是装置缺口而非产品缺陷 */
    setTimeout,
    clearTimeout,
  });
  const exportsTail =
    "\n;globalThis.__h = handlers; globalThis.__execute = execute;" +
    " globalThis.__nodeInfo = nodeInfo; globalThis.__opNames = OP_NAMES;" +
    " globalThis.__idKeys = ID_KEYS;";
  vm.runInContext(src + exportsTail, vmCtx);

  return {
    handlers: vmCtx.__h,
    execute: vmCtx.__execute,
    nodeInfo: vmCtx.__nodeInfo,
    opNames: vmCtx.__opNames,
    /** FR-2 · 需要在夹具里制造 figma.mixed 形态（混排）时取这个符号 */
    figma: figmaStub,
    /** 允许承载 "@last" / "$name" 的节点引用字段（与 run 的判定同源） */
    idKeys: vmCtx.__idKeys,
    nodes,
    page,
    stats,
    /** 声明"这个外部 id 期望是什么类型"，供 autoVivify 使用（仅影响装置，不改源码行为） */
    hintRef: (id, type) => hints.set(id, type),
    makeNode: (type, props) => makeNode(type, props, ctx),
    register: (n) => (nodes.set(n.id, n), n),
    link,
  };
}

export { ROOT };

#!/usr/bin/env node
/**
 * runtime-check.mjs — agent-design-figma 运行时能力探针
 *
 * 职责：只读探测，不做任何写操作，不创建新通信协议，不修改 Bridge / Plugin。
 *   A. Figma 写能力 = Figma Plugin Bridge 可达 且 插件已连接（GET /health 公开端点）
 *   B. Figma 读能力 = A 成立时由 Bridge 自己提供（get-page-summary / get-node / export-node）
 *                      或 用户 MCP 配置（~/.workbuddy/mcp.json 或 ~/.codebuddy/mcp.json）中
 *                      存在启用的 Figma MCP（figma-context / figma-developer-mcp / framelink 等）
 *
 * 输出 runtime-capability.json：
 *   { version, figmaRead, figmaWrite, executor, mode, details, checkedAt }
 *   version 读自技能根目录的 VERSION 文件（路径由本脚本自身定位，不受 cwd 影响）
 *
 * mode 判定（Skill 消费的唯一契约）：
 *   FULL_MODE      写✅          → L1→L2→L3→L4→L5 全链路
 *   READ_ONLY_MODE 写❌ 读✅     → L1→L2 + Build Plan，提示安装 Bridge
 *   OFFLINE_MODE   全部❌        → 仅设计资产（Brief / DS Spec / Build Plan）
 *
 * 用法（任意 cwd 都可运行；输出路径由本脚本自身定位，不受 cwd 影响）：
 *   node <skill 根目录>/tools/runtime-check.mjs
 *   node <skill 根目录>/tools/runtime-check.mjs --out ./runtime-capability.json --no-write
 *
 * 无参数时输出落在 <skill 根目录>/.vibe/runtime-capability.json。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE_URL = process.env.AGENT_BRIDGE_URL || "http://127.0.0.1:45677";
const args = process.argv.slice(2);
const outFlag = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const noWrite = args.includes("--no-write");

async function fetchWithTimeout(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** A. 写能力：Bridge /health 是公开只读端点（无 token、无副作用），plugin.connected 表示插件在位 */
async function probeBridge() {
  const res = await fetchWithTimeout(`${BRIDGE_URL}/health`, 2500);
  if (!res || res.status !== 200 || !res.body) {
    return { reachable: false, pluginConnected: false, url: BRIDGE_URL };
  }
  const j = res.body;
  const isBridge = j.service === "agent-design-figma-bridge" && j.ok === true;
  return {
    reachable: isBridge,
    pluginConnected: isBridge && j.plugin?.connected === true,
    pluginLabel: j.plugin?.label ?? null,
    editorType: j.plugin?.info?.editorType ?? null,
    url: BRIDGE_URL,
  };
}

/** B. 读能力：仅检查 MCP 配置文件中"已启用"的 Figma MCP（stdio 型进程无法从外部探活，配置存在即视为可用） */
function probeMcpRead() {
  const candidates = [
    path.join(os.homedir(), ".workbuddy", "mcp.json"),
    path.join(os.homedir(), ".codebuddy", "mcp.json"),
  ];
  const found = [];
  let configured = false;
  let usedPath = null;
  for (const cfgPath of candidates) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    } catch {
      continue; // 该路径没有配置文件
    }
    usedPath = usedPath || cfgPath;
    for (const [name, srv] of Object.entries(cfg.mcpServers || {})) {
      if (srv?.disabled === true) continue;
      const haystack = [name, ...(srv.args || [])].join(" ").toLowerCase();
      if (haystack.includes("figma")) {
        if (!found.includes(name)) found.push(name);
        if (haystack.includes("figma-context") || haystack.includes("figma-developer-mcp") || haystack.includes("framelink")) {
          configured = true; // 已知具备读能力的 Figma MCP
        }
      }
    }
  }
  return { available: configured, servers: found, configPath: usedPath };
}

/** C. 版本：读技能根目录的 VERSION（路径由本脚本自身定位，不受 cwd 影响） */
function readVersion() {
  try {
    return fs.readFileSync(fileURLToPath(new URL("../VERSION", import.meta.url)), "utf8").trim() || null;
  } catch {
    return null; // 老版本可能没有 VERSION 文件，不因此让探针失败
  }
}

const bridge = await probeBridge();
const mcp = probeMcpRead();

// Read capability has TWO possible sources, and only the MCP one used to be
// checked. In FULL_MODE that produced the self-contradictory report
// figmaWrite:true / figmaRead:false, which reads to a user as "your environment
// is half broken" when in fact the bridge answers reads itself through
// get-page-summary / get-node. So a live bridge+plugin counts as read too.
const BRIDGE_READ_OPS = ["get-page-summary", "get-node", "export-node"];
const bridgeRead = bridge.reachable && bridge.pluginConnected;
const figmaWrite = bridgeRead;
const figmaRead = bridgeRead || mcp.available;
const readSources = [
  ...(bridgeRead ? [`bridge:${BRIDGE_READ_OPS.join(",")}`] : []),
  ...(mcp.available ? [`mcp:${mcp.servers.join(",") || "figma"}`] : []),
];
const mode = figmaWrite ? "FULL_MODE" : figmaRead ? "READ_ONLY_MODE" : "OFFLINE_MODE";

const capability = {
  version: readVersion(),
  figmaRead,
  figmaWrite,
  executor: figmaWrite ? "figma-plugin-bridge" : null,
  mode,
  details: {
    bridge,
    figmaMcp: mcp,
    readSources,
    readOps: bridgeRead ? BRIDGE_READ_OPS : [],
    hints: figmaWrite
      ? null
      : figmaRead
        ? "当前环境只有读取能力，需要安装 Figma Bridge 才能自动绘制"
        : "未检测到 Figma 连接能力，仅可生成设计资产（Brief / DS Spec / Build Plan）",
  },
  checkedAt: new Date().toISOString(),
};

console.log(JSON.stringify(capability, null, 2));

if (!noWrite) {
  const out = outFlag
    ? path.resolve(outFlag)
    : fileURLToPath(new URL("../.vibe/runtime-capability.json", import.meta.url));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(capability, null, 2) + "\n");
  console.error(`capability written: ${out}`);
}

# Runtime Capability — 运行时能力判定与降级规则（L0）

Skill 在执行任何层之前，必须先知道"这个环境能跑多远"。本文定义能力探测、三模式矩阵与逐层降级行为。

## 1. 探测实现

唯一入口：`tools/runtime-check.mjs`（node，无外部依赖）。

| 能力 | 探测方式 | 判定为 ✅ 的条件 |
|---|---|---|
| **Figma 写能力** | `GET {BRIDGE_URL}/health`（公开端点，无 token、无副作用，复用现有 Bridge，零协议新增） | `service === "agent-design-figma-bridge"` 且 `plugin.connected === true` |
| **Figma 读能力** | ① 同一探活即可判定：Bridge 插件在位时自带 `get-page-summary` / `get-node` / `export-node`；② 读 `~/.workbuddy/mcp.json` 或 `~/.codebuddy/mcp.json`，存在**未 disabled** 且名称/参数含 `figma` 的已知读取型 MCP（figma-context / figma-developer-mcp / framelink） | ① 或 ② **任一**成立 |

约束（硬性）：
- 探针**只读**：不创建新通信协议、不修改 Bridge 核心、不修改 Figma Plugin。
- stdio 型 MCP 进程无法从外部探活，故"配置存在且启用"即视为读能力可用（诚实标注：探测的是配置而非连通性）。
- Bridge 可达但 `plugin.connected === false` ≠ 写能力，也 ≠ 读能力——读写都在插件里执行，插件没连等于两样都没有。
- **读能力不只来自 MCP**。把读能力只认成 MCP，会让 FULL_MODE 输出 `figmaWrite:true / figmaRead:false` 这种自相矛盾的报告，用户会误判成环境残缺。实际来源记在 `details.readSources`。

## 2. 输出契约（runtime-capability.json）

```json
{
  "version": "1.2.0-dev",
  "figmaRead": true,
  "figmaWrite": true,
  "executor": "figma-plugin-bridge",
  "mode": "FULL_MODE",
  "details": {
    "bridge": { "reachable": true, "pluginConnected": true, "url": "..." },
    "figmaMcp": { "available": true, "servers": ["figma-context"] },
    "readSources": ["bridge:get-page-summary,get-node,export-node", "mcp:figma-context"],
    "readOps": ["get-page-summary", "get-node", "export-node"],
    "hints": null
  },
  "checkedAt": "ISO-8601"
}
```

- `version`：读自技能根目录的 `VERSION` 文件，用于确认当前跑的是哪个版本（`-dev` 后缀 = 开发中未发布）。**每个交付物都应带上它**，这样"这份稿子是哪个版本画的"永远可答。
- `mode` 枚举锁死：`FULL_MODE | READ_ONLY_MODE | OFFLINE_MODE`
- `executor`：仅写能力存在时为 `"figma-plugin-bridge"`，否则 `null`
- `details.readSources`：读能力的实际来源清单（bridge / mcp），用于解释"为什么 FULL_MODE 也是 figmaRead:true"
- 默认落盘到 `<skill 根目录>/.vibe/runtime-capability.json`（路径由脚本用 `import.meta.url` 定位，**不受 cwd 影响**；`--out` 可改，`--no-write` 仅打印）

## 3. Capability Matrix（Skill 消费的唯一判定表）

| 模式 | figmaWrite | figmaRead | 执行范围 | 用户可见提示 |
|---|---|---|---|---|
| **FULL_MODE** | ✅ | ✅（Bridge 自带读能力） | L1 → L2 → L3 → L4 → L5 | 正常流程 |
| **READ_ONLY_MODE** | ❌ | ✅ | L1 → L2 → **Build Plan JSON**（不执行） | "当前环境只有读取能力，需要安装 Figma Bridge 才能自动绘制" |
| **OFFLINE_MODE** | ❌ | ❌ | 仅设计资产：Brief / DS Spec / Build Plan | "未检测到 Figma 连接能力，仅可生成设计资产（Brief / DS Spec / Build Plan）" |

## 4. 逐层降级规则

- **L1 / L2**：三模式全部可跑（纯知识层，不碰 Figma）。
- **L3 Build Plan**：三模式全部产出 Build Plan（当前作为 DS Spec 的 `buildPlan` 字段，不单独出文件）；仅 FULL_MODE 将其交给 Adapter 执行。
- **L4 Critic**：仅 FULL_MODE 可跑。READ_ONLY 下若仅有读 MCP 且用户提供了 Figma 文件链接，允许对**已存在**的页面做只读审查，但不得谎称为生成后审查。
- **L5 Export**：仅 FULL_MODE。其余模式输出 export-manifest 的 `design-phase` 规划态（复用 Export Gate 既有语义：criticScore 缺失 ⇒ 不放行 live-build）。
- **诚实铁律**：任何模式都不得假装执行了被降级的层；未跑的层在交付物中标注 `"mode": "<mode>"` 与降级原因。

> 注：FULL_MODE 下 `figmaRead` 为 true，但**不要求**用户另外配置读 MCP——Bridge 自带 `get-page-summary` / `get-node` / `export-node`，Critic 取证与回读走 Bridge 即可；读 MCP 属于增益（可对既有页面做对比、批量截图取证）。

## 5. 与五层的接线

```
用户 Prompt
  → [L0] node <skill 根目录>/tools/runtime-check.mjs → mode
  → mode 路由（上表）
  → 各层产物按 mode 裁剪
```

Adapter（通道适配）只在 FULL_MODE 介入：Build Plan → Bridge 方言（现状即 仓库既有构建脚本 的既有形态，不扩大架构）。

# SETUP — 5 分钟安装指南

读者假设：**普通用户**。不需要理解 Skill 内部架构，只需要照做。

## 你将得到什么

- 不安装 Figma 插件：Skill 仍可用，输出设计文档（Brief / DS Spec / Build Plan）——OFFLINE 或 READ_ONLY 模式
- 安装后（推荐）：页面会**自动画进你的 Figma 文件**，并自动审查、导出 PNG/SVG——FULL_MODE

---

## Step 1 — 安装 Skill（≈1 分钟，只需一次）

把本仓库放到技能目录，并让**文件夹名为 `agent-design-figma`**：

```bash
git clone git@github.com:JasonOracle/agent-design-figma.git ~/.workbuddy/skills/agent-design-figma
```

- Windows 的技能目录是 `%USERPROFILE%\.workbuddy\skills\`
- 不用 git 也可以：下载仓库 ZIP → 解压 → 把整个文件夹放进技能目录
- 若你用的 IDE 系工具读取 `.codebuddy/skills/`，两个目录各放一份即可

验证：对 Agent 说"帮我检查 agent-design-figma 是否安装"，或直接进入 Step 4 试一句。

## Step 2 — 配置 Figma（≈3 分钟，只需一次）

1. **安装 Figma Desktop**（已装可跳过）：https://www.figma.com/downloads/
2. **导入 Bridge 插件**（插件随仓库分发，就在仓库根目录的 `figma-plugin/`）：
   - Figma 菜单 → Plugins → Development → **Import plugin from manifest…**
   - 选择 `figma-plugin/manifest.json`（`code.js` / `ui.html` 与它同目录）
3. **启动 Bridge**——在**仓库根目录**（也就是有 `bridge/` 的那个目录）执行：

   ```bash
   node bridge/server.js
   ```

   零依赖，无需 `npm install`，只需要 Node.js ≥ 18。启动后**保持这个终端窗口开着**，它会打印一行 `token: xxxx…`，复制它。
   （Bridge 只监听本机回环地址 127.0.0.1:45677，不对外网开放。）
4. **连接插件**：在 Figma 中打开任意设计文件 → Plugins → Development → **agent-design-figma Bridge (Dev)** → 把 token 粘贴进插件面板 → Connect。面板显示已连接即成功。

> 为什么需要 token：Bridge 只监听本机回环地址，token 防止其他本地进程误用你的 Figma 连接。每次重启 Bridge token 保持不变（存放在运行目录下自动生成的 `.vibe/token` 文件中）。

### Windows / macOS 差异

| 事项 | Windows | macOS |
|---|---|---|
| 启动 Bridge | 同为 `node bridge/server.js`（需 Node.js ≥18） | 相同 |
| Skill 目录 | `%USERPROFILE%\.workbuddy\skills\` | `~/.workbuddy/skills/` |
| 首次运行 Bridge | 若防火墙弹窗，选择"允许（仅专用网络）" | 若弹窗，选择"允许" |
| 终端 | PowerShell / CMD / Git Bash 均可 | Terminal / iTerm |

其余步骤两个平台完全一致（Figma Desktop 界面相同）。

## Step 3 — 自检（≈10 秒）

在仓库根目录执行：

```
node tools/runtime-check.mjs
```

期望输出：

```json
{
  "figmaRead": true,
  "figmaWrite": true,
  "executor": "figma-plugin-bridge",
  "mode": "FULL_MODE"
}
```

- `READ_ONLY_MODE`：只有读取能力，需要安装 Figma Bridge 才能自动绘制（回到 Step 2）
- `OFFLINE_MODE`：未检测到 Figma 连接能力（Bridge 未启动或插件未连接）

## Step 4 — 首次运行（≈1 分钟）

对 Agent 直接说：

> 设计一个现代 AI 健康管理 App 首页

FULL_MODE 下你会依次得到：`design-brief.json` → `design-system-spec.json` → Figma 页面（自动绘制，会请你确认 Brief/Spec 两次）→ `critic-report.json` → `export-manifest.json` + PNG/SVG。

完整走查（每步谁操作、看什么、耗时）见 **[USER_GUIDE.md](USER_GUIDE.md)**。

---

## 可选：接入 Figma 读取类 MCP（提升审查与对比能力）

若已配置 `figma-context` / figma-developer-mcp（`~/.workbuddy/mcp.json` 或 `~/.codebuddy/mcp.json`），探针会自动识别为读能力，Critic 可用它截图取证。未配置也不影响主流程——Skill 用 Bridge 自带的导出能力取证。

## 故障排查

| 现象 | 处理 |
|---|---|
| 探针显示 `OFFLINE_MODE` 但 Bridge 已启动 | 检查插件是否点了 Connect；重启 Figma 后需重新运行插件 |
| 探针 `figmaWrite: false` 但端口通 | `/health` 的 `plugin.connected` 为 false = 插件未连接，重跑插件并 Connect |
| 提示端口已被占用 | 已有一个 Bridge 在跑（可能开了多个终端）；关掉多余的，或换端口启动 |
| `Cannot find module .../bridge/server.js` | 你没在仓库根目录执行。先 `cd` 到含 `bridge/` 的目录，或写绝对路径 |
| 修改了插件代码不生效 | Figma 插件不会热更新：Plugins → Development → 重新运行 agent-design-figma Bridge (Dev) |
| 端口冲突 | `AGENT_BRIDGE_URL` 环境变量可改探针目标；Bridge 端口见其启动日志 |
| 找不到 `figma-plugin/` 目录 | 确认放进技能目录的是**完整仓库文件夹**（含 figma-plugin / bridge / tools / assets / references），而不是只拷了 `SKILL.md` |
| Figma 导入插件报错 | 确认选的是 `figma-plugin/manifest.json`，且 `code.js` / `ui.html` 与它同一目录 |

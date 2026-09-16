# agent-design-figma · AI UI 设计技能

一句话：**你只说"设计一个 AI 医疗 App 首页"，它自动完成从设计定位到 Figma 成稿再到质量审查与交付文件的全过程。**

安装后你只需要告诉 AI 你想设计什么——行业风格、配色、字体、组件、页面结构，全部由 Skill 自动推导；生成结果会经过自动视觉审查，不达标会自动修复并复检。

## 它能做什么

| 你输入 | 你得到 |
|---|---|
| "设计一个现代 AI 健康管理 App 首页" | 设计定位文档 → 设计系统 → **Figma 页面（自动绘制）** → 视觉质量审查报告 → PNG / SVG / 交付清单 |
| "设计一个河南高速智慧养护大屏" | 同上，自动套用政务大屏暗色风格与行业色板 |
| "设计一个企业后台 Dashboard" | 同上，自动套用企业级中后台风格 |

支持中文行业语义（医疗 / 政务 / 教育 / 企业后台等），配色与风格来自内置行业映射规则，不随机、不套模板。

## 安装（3 步）

**1. 把本仓库放进技能目录**

```bash
git clone git@github.com:JasonOracle/agent-design-figma.git ~/.workbuddy/skills/agent-design-figma
```

Windows 对应 `%USERPROFILE%\.workbuddy\skills\`；不熟悉 git 也可以直接下载 ZIP，解压后把整个文件夹放进该目录，文件夹名保持 `agent-design-figma`。
（部分 IDE 系工具读取的是 `.codebuddy/skills/`，两个目录都放一份最省事。）

**2. 在仓库根目录启动本地桥接程序**（零依赖，无需 npm install）

```bash
node bridge/server.js
```

终端会打印一行 `token: xxxx…`，复制它。

**3. 在 Figma 中导入随附插件并连接**

Figma Desktop → Plugins → Development → Import plugin from manifest… → 选择本仓库的 `figma-plugin/manifest.json`；运行插件，把 token 粘进面板点 Connect，顶部变绿即成功。

详细步骤见 **[SETUP.md](SETUP.md)**，完整使用教程见 **[USER_GUIDE.md](USER_GUIDE.md)**。

自检（≈10 秒，确认环境就绪）：

```bash
node tools/runtime-check.mjs
```

期望看到 `"mode": "FULL_MODE"`。

> 不装 Figma 插件也能用：Skill 会输出完整设计文档（定位 / 设计系统 / 构建计划），只是不会自动画进 Figma。

## 目录

- `SKILL.md` — Agent 执行手册（设计流水线规则）
- `SETUP.md` — 安装指南（普通用户视角，5 分钟）
- `USER_GUIDE.md` — 使用教程（第一次运行全流程走查）
- `bridge/server.js` — 本地桥接程序（零依赖，Figma 自动绘制的写通道）
- `figma-plugin/` — Figma 插件（导入用，含 manifest / code.js / ui.html）
- `tools/runtime-check.mjs` — 运行环境自检探针（L0）
- `references/` — 设计智能规则（行业映射 / 视觉审查 / 映射规则 / 运行模式判定）
- `assets/templates/` — 各类交付物的 JSON Schema
- `assets/examples/` — 三个行业的完整示例（企业后台 / 医疗 App / 政务大屏）

## 运行模式（自动判定，无需配置）

Skill 每次启动会用 `tools/runtime-check.mjs` 探测环境，自动选择能跑多少跑多少：

| 模式 | 条件 | 执行范围 |
|---|---|---|
| **FULL_MODE** | Figma 插件已连接 | 全流程：设计 → 自动绘制 → 审查 → 导出 |
| **READ_ONLY_MODE** | 只有 Figma 读取类 MCP | 设计文档 + 构建计划；提示"当前环境只有读取能力，需要安装 Figma Bridge 才能自动绘制" |
| **OFFLINE_MODE** | 均无 | 仅生成设计文档三件套，诚实标注未执行 |

任何模式都**不会假装执行**——没跑的步骤会明确说没跑。

## 技术边界（可选阅读）

Skill 是设计大脑，只产出 JSON 契约与构建计划；对 Figma 的实际读写由你环境里的现有通道完成（本仓库自带的插件 + 本地桥接程序，或市场已有的 Figma MCP）。**本 Skill 不开发、不替代任何 MCP。**

---

## English

**agent-design-figma** is an AI UI design skill: describe the screen you want in one sentence (product type + page + vibe), and it runs the whole pipeline for you — design brief → design system → **automatically drawing the page into your Figma file** → automated visual critique (5 dimensions, self-repair up to 3 rounds) → PNG / SVG / export manifest.

Requirements: Node.js ≥ 18 (no npm install needed — the bundled bridge uses only Node built-ins) and Figma Desktop for the drawing step. Works in Chinese; industry semantics (healthcare / government / education / enterprise dashboard) are built in.

Quick start: `git clone` this repo into your skills directory, run `node bridge/server.js`, import `figma-plugin/manifest.json` into Figma, paste the token. Then just say *"design an AI health app home screen"*.

MIT licensed.

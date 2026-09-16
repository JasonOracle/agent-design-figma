# agent-design-figma · AI UI 设计技能

[English Version](README_EN.md)

一句话：**你只说"设计一个 AI 医疗 App 首页"，它自动完成从设计定位到 Figma 成稿再到质量审查与交付文件的全过程。**

安装后你只需要告诉 AI 你想设计什么——行业风格、配色、字体、组件、页面结构，全部由 Skill 自动推导；生成结果会经过自动视觉审查，不达标会自动修复并复检。

## 项目背景与渊源

本项目脱胎于我的全链路开源实验项目 —— [JasonOracle/figma-agent-bridge](https://github.com/JasonOracle/figma-agent-bridge)（旨在探索 AI Agent 从设计系统构建、整页高保真设计，到前端代码还原的全链路自动化）。

在原本的 `figma-agent-bridge` 项目中，我成功构建了一条让 AI 直接操作真实 Figma 画布的本地通道。为了让这套强大的“AI 设计大脑”能够被更广泛地复用，我将其中最核心的 **自动化 UI 设计技能（Skill）** 提炼出来，经过深度优化与封装，独立封装为当前的 `agent-design-figma` 项目。

它专注于解决一个核心场景：**赋予大模型专业的 UI 设计认知与跨端落地能力**。你可以将它作为独立组件，无缝接入你自己的 AI 助理或 Agent 开发流中，零门槛获得一条开箱即用的自动化设计流水线。

## 它能做什么

| 你输入 | 你得到 |
|---|---|
| "设计一个现代 AI 健康管理 App 首页" | 设计定位文档 → 设计系统 → **Figma 页面（自动绘制）** → 视觉质量审查报告 → PNG / SVG / 交付清单 |
| "设计一个河南高速智慧养护大屏" | 同上，自动套用政务大屏暗色风格与行业色板 |
| "设计一个企业后台 Dashboard" | 同上，自动套用企业级中后台风格 |

支持中文行业语义（医疗 / 政务 / 教育 / 企业后台等），配色与风格来自内置行业映射规则，不随机、不套模板。

## 实际生成效果展示

以下是新用户安装 Skill 后，只需简单一句话指令，由大模型全自动生成并渲染到 Figma 的真实效果文件展示。

**Figma 客户端真实画布渲染效果：**

<div align="center">
  <img src="./assets/demo-outputs/figma-workspace.png" width="100%" alt="Figma Workspace Screenshot" />
</div>
<br/>

**生成的高清页面细节（含首页、产品、关于我们等）：**

<div align="center">
  <img src="./assets/demo-outputs/home@2x.png" width="48%" alt="Home Page Generation" />
  <img src="./assets/demo-outputs/about@2x.png" width="48%" alt="About Page Generation" />
</div>
<br/>
<div align="center">
  <img src="./assets/demo-outputs/products@2x.png" width="48%" alt="Products Page Generation" />
  <img src="./assets/demo-outputs/story@2x.png" width="48%" alt="Story Page Generation" />
</div>

*注：以上页面从产品结构规划、文案生成、设计系统搭建到 Figma 节点渲染，全程由 Agent 零人工干预自动完成。*

## 安装（3 步）

**1. 把本仓库放进技能目录**（挑你的工具实际读取的那一个，不确定就两个都放）

```bash
# WorkBuddy —— Windows 对应 %USERPROFILE%\.workbuddy\skills\
git clone https://github.com/JasonOracle/agent-design-figma.git ~/.workbuddy/skills/agent-design-figma

# CodeBuddy / 部分 IDE 系工具读的是这一个 —— Windows 对应 %USERPROFILE%\.codebuddy\skills\
git clone https://github.com/JasonOracle/agent-design-figma.git ~/.codebuddy/skills/agent-design-figma
```

不熟悉 git 也可以下载 ZIP（仓库页 → Code → Download ZIP），解压后把整个文件夹放进对应目录，**文件夹名保持 `agent-design-figma`**。

> 上面一律用 HTTPS。SSH 地址（`git@github.com:`）需要先配好 SSH key，没配会直接失败。

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
node ~/.workbuddy/skills/agent-design-figma/tools/runtime-check.mjs
```

期望看到 `"mode": "FULL_MODE"`，且 `figmaRead` 与 `figmaWrite` **都是 `true`**——读能力不只来自 MCP，Bridge 自带 `get-page-summary` / `get-node` / `export-node`。任意工作目录都能跑，结果落在技能目录下的 `.vibe/runtime-capability.json`。

**写通道自检**（离线，不需要 Figma，≈1 秒）：

```bash
node ~/.workbuddy/skills/agent-design-figma/tools/qa-plugin.mjs
```

用严格的 Figma 校验桩跑一遍四种 effect 类型与节点读回语义。全绿才说明 `BACKGROUND_BLUR`（毛玻璃的唯一实现路径）在插件当前版本上真的可用——这正是本版修掉的一个 P0 事故，现在有回归测试兜着。

> 不装 Figma 插件也能用：Skill 会输出完整设计文档（定位 / 设计系统 / 构建计划），只是不会自动画进 Figma。

## 目录

- `SKILL.md` — Agent 执行手册（L0–L5 设计流水线规则）
- `SETUP.md` — 安装指南（普通用户视角，5 分钟）
- `USER_GUIDE.md` — 使用教程（第一次运行全流程走查）
- `bridge/server.js` — 本地桥接程序（零依赖，Figma 自动绘制的写通道；含 `POST /v1/batch` 批量通道）
- `figma-plugin/` — Figma 插件（导入用，含 manifest / code.js / ui.html）
- `references/bridge-ops.md` — **写通道 op 权威清单**（36 个 op、参数形状、批量语法、错误码、毛玻璃配方）
- `references/design-system.md` — **L2 契约**（Brief→DS Spec 推导：五类 Token / 白名单派生 / 组件决策矩阵 / 状态矩阵 / 四平台布局模板）
- `references/` — 设计智能规则（行业映射 / 风格库 / 视觉审查 / 映射规则 / 运行模式判定）
- `tools/runtime-check.mjs` — 运行环境自检探针（L0）
- `tools/qa-plugin.mjs` — 插件回归测试（离线跑，覆盖四种 effect 类型与读回语义）
- `tools/qa-bridge.mjs` — Bridge 端到端测试（起真实服务 + mock 插件，覆盖批量通道）
- `tools/qa-l2.mjs` — L2 产出校验（四项：Schema / Token 无未知色 / 覆盖与数量 / DS 单源）；可校验任意产物（`--spec` + `--brief`）
- `tools/qa-l2-mutation.mjs` — 对 qa-l2 的变异测试（逐项注入已知错误，确认校验真的会报警——防「永远 PASS 的假校验」）
- `tools/layout-audit.mjs` — L4 布局审计（gap / 对齐 / 档位 / 越界 / 触控，基于 get-node 实测坐标）
- `tools/contrast-audit.mjs` — L4 Color 维对比度审计：从 DS Spec tokens 复算「文本 × 表面」矩阵的 WCAG 比值，并把 `accessibility.contrast` 里**手写的每个数字**与复算逐条比对（首次运行即发现随包样例 13 条声称值里 9 条不符）
- `tools/contrast-audit-mutation.mjs` — 对 contrast-audit 的变异测试（36 例：注入 9 类错误 + 边界值/非白背景/非 hex 取值，确认能抓错且不误报）
- `tools/qa-critic.mjs` — L4 Critic 产出校验（134 断言：Schema / 五维评分与 average 实算 / issue 证据须带量或核对动作 / targetLayer 路由 / loop 自洽 / `_evidence` 档位契约 / 跨产物一致）；可校验任意产物（`--report` + `--brief` + `--spec`），`--strict` 让软提示升为失败
- `tools/qa-critic-mutation.mjs` — 对 qa-critic 的变异测试（51 条断言：注入 30+ 类已知缺陷 + 一次全报 + `--strict` 升档 + 自带样例零告警门禁）
- `tools/qa-export.mjs` — **L5 出口闸门**（935 条断言，QA1–QA9：内置最小 draft-07 校验器对清单做**真 Schema 校验** / 导出物存在 / node id 可回读 / 映射完整 / **token `value` 快照复算 + `source` 继承** / 无孤儿 + Export Gate 自洽 / 冻结禁区零修改 / **身份一致** / **可追溯性**）。首次运行即发现 32 处产物与其声明的 DS Spec 对不上，并修掉 Schema 里一处「描述说允许、语义不允许」的条件分支（`if/then` 只能叠加，放宽必须写在 `else`）
- `tools/qa-export-mutation.mjs` — 对 qa-export 的变异测试（56 条断言：注入 30+ 类已知缺陷 + Schema 条件分支正反两例 + 基线零告警 + 冻结态「核不了必须说核不了」+ 无 `.git` 路径）
- `tools/precheck.mjs` — **构建计划开工前预检**（L3）：把你的 op 序列离线过一遍真 `code.js`，一次报出全部静态错误（未知 op / 缺必填 / 参数类型 / 颜色格式 / 效果字段被静默丢弃）；`--live` 可再核对画布已有 id
- `tools/precheck-mutation.mjs` — 对 precheck 的变异测试（63 条断言：注入 13 类错误 + 36 op 全通跑 + B2 在线核对端到端）
- `tools/figma-harness.mjs` — 离线加载真 `code.js` 的共享装置（严格效果桩 + 效果字段两侧契约），供 qa-plugin 与 precheck 共用
- `tools/check-refs.mjs` — 文档引用校验（扫随包 `.md`，命令式引用与反引号路径逐条落地判定，悬空则非零退出）
- `tools/check-refs-mutation.mjs` — 对 check-refs 的变异测试（造含已知错误的样本仓库，断言能抓错且不误报）
- `references/lessons.md` — **实测不变量 44 条**（协议 / Plugin API / 数据流 / 测试 / Windows 环境 / 协作；标注哪些已被工具守卫、哪些只能靠纪律）
- `assets/examples/example-health.ops.json` — 一份真实的 L3 构建计划样例（42 步），可直接喂给 `precheck.mjs`
- `assets/style-library/` — 四套 Style Preset（企业后台 / 政务大屏 / 品牌官网 / 现代 SaaS）
- `assets/templates/` — 各类交付物的 JSON Schema
- `assets/examples/` — 三个行业的完整示例（企业后台 / 美业 AI 试发 / 政务大屏）；另含 `assets/examples/export/files/` 下**一份医疗 App 的导出随包副本**——它与 `example-health.*` 同名但**不是同一个项目**（美业 vs 医疗），见 `references/lessons.md` #44

## 运行模式（自动判定，无需配置）

Skill 每次启动会用 `tools/runtime-check.mjs` 探测环境，自动选择能跑多少跑多少：

| 模式 | 条件 | 执行范围 |
|---|---|---|
| **FULL_MODE** | Figma 插件已连接 | 全流程：设计 → 自动绘制 → 审查 → 导出（读能力由 Bridge 自带） |
| **READ_ONLY_MODE** | Bridge 未连，但有 Figma 读取类 MCP | 设计文档 + 构建计划；提示"当前环境只有读取能力，需要安装 Figma Bridge 才能自动绘制" |
| **OFFLINE_MODE** | 均无 | 仅生成设计文档三件套，诚实标注未执行 |

任何模式都**不会假装执行**——没跑的步骤会明确说没跑。

## 技术边界（可选阅读）

Skill 是设计大脑，只产出 JSON 契约与构建计划；对 Figma 的实际读写由你环境里的现有通道完成（本仓库自带的插件 + 本地桥接程序，或市场已有的 Figma MCP）。**本 Skill 不开发、不替代任何 MCP。**

---

MIT licensed.

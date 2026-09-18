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
- `references/acceptance-criteria.md` — **D1 硬验收标准**（先定档再判 + 「零人工补丁 / 零失效引用 / 零目测评分」三条各自的机械闸门 / 命令表 + 留痕模板 + 三档归因 + 如实列出的盲区）
- `references/design-criteria-intake.md` — **外部设计判据的吸纳筛法（F4）**：成熟设计 skill 的检查条目要**逐条过四道筛**（**静态？→ 前提是否成立？→ 可判定？→ 检查还是配方？**）才能收编，答案只有「搬 / 译 / 交人 / 无对象 / 已有」五种，外加「**拆**」（一条规则内部结论不同，须再分一次）。附 **3 份来源共 46 条**原则的逐条分档（一手回指）：`better-ui` 17 条 · `better-layout` 10 条 · `better-typography` 19 条 —— 实测 **43% 在静态画布上无处落地**，**33% 必须逐句拆开**。含「`get-node` 到底回传哪些字段」的**回读契约表**、「连续公式撞离散白名单」的裁决样例（同心圆角）、以及供 F3 读图清单的第一批条目
- `references/read-image-checklist.md` — **读图检查清单（F3③ · 随包正本，14 条）**：只读图可判的缺陷模式——E1 语义性缺失 4 条（无轴标 / 无单位 / 无空态 / 无图例）+ 外部判据过筛后的读图内核 4 条（孤字坏换行 / 截断可达性 / 混排顺序 / 阅读顺序）+ 自有增益项 3 条（icon 风格 / 视觉焦点 / **商业产品相似度——锚点并置装置在 F3② 建成前只允许记 n-a**）。**读图项不是闸门项**（H3 零目测评分）：产出是带可回放证据的观察记录（verdict `ok`/`issue`/`n-a`，落盘 run 目录一份 `read-image-review.json`），不是分数；**F3① 起，`structured+vision` 评审必须逐条留痕——能读而不读 = 违规**
- `references/` — 设计智能规则（行业映射 / 风格库 / 视觉审查 / 映射规则 / 运行模式判定）
- `tools/runtime-check.mjs` — 运行环境自检探针（L0）
- `tools/qa-plugin.mjs` — 插件回归测试（离线跑，覆盖四种 effect 类型与读回语义）
- `tools/qa-bridge.mjs` — Bridge 端到端测试（起真实服务 + mock 插件，覆盖批量通道）
- `tools/qa-l2.mjs` — L2 产出校验（四项：Schema / Token 无未知色 / 覆盖与数量 / DS 单源）；可校验任意产物（`--spec` + `--brief`）
- `tools/qa-l2-mutation.mjs` — 对 qa-l2 的变异测试（逐项注入已知错误，确认校验真的会报警——防「永远 PASS 的假校验」）
- `tools/layout-audit.mjs` — L4 布局审计（**13 类检查**：spacing / padding / radius / font-size / alignment / touch / overflow / baseline / overlap / duplicate / text-container-fixed / text-justified / font-family-count，基于 get-node 实测坐标）。**档位优先从 L2 DS Spec 派生**（`--spec <dsspec.json>`，1.3 A2）——手敲档位是「同一份数据得出不同告警数」的根因；产物里 `paramSource` / `paramGaps` 记着每个数的来源；`geometryCoverage` 记着**多少个节点真跑过检查**——`get-node` 默认 `depth:1` 时子级无几何，那些节点**一条检查都跑不到**（实测同一棵 5 节点树 `{depth:1}` → **1/2**、`{depth:2}` → **2/5**，两者**浅容器数都是 1** 而漏掉的是 1 个与 3 个节点；容器数是代理指标，节点数才是规模。一键复核：`tools/layout-audit-readback-probe.mjs`）。**1.3 F4 第 3 步新增三类 + 一处分级**：`text-container-fixed`（文本容器 `textAutoResize=NONE`，宽高全固定 ⇒ 文本增长只能溢出或被裁）/ `text-justified`（两端对齐）/ `font-family-count`（字族 > 上限，默认 3）；overflow 在父级 `clipsContent=true` 时升 **high**（静默隐藏），`TRUNCATE` 文本**只进 `textTruncated` 清单、不报问题**（已开省略号是有意行为）。三类全部来自「未使用字段清单」（见 `tools/contract-usage.mjs`）
- `tools/layout-audit-mutation.mjs` — 对 layout-audit 的变异测试（**125 条断言**：能抓错 + **不误报**（假阳性治理是本工具的主要成本）+ 跳过留痕 + 参数派生反向对照 + **几何覆盖率**（含「几何给足时不得报浅回读」的反向对照）+ 1.3 F4 第 3 步的三类新检查正反两面 + **#48 反向对照：`--json` 输出喂文本断言必须抛**（防断言空转恒 PASS））
- `tools/pixel-proof.mjs` — **L4 效果类参数的像素可见性装置**（1.3 C1 收编，零依赖）：单图出直方图（颜色数 / 底色 / 非底色占比）+ ASCII 密度图（看内容**分布**而非总量）；给两张图出逐像素差异。`--expect-diff` / `--expect-same` / `--expect-content` 把结论变成退出码，可直接当闸门。治 `lessons.md` #56（填充透明度等参数**结构回读是盲的**，`paintToHex` 丢掉 `paint.opacity`）/ #57（效果作用在纯色上没有可观察后果）/ #59（导出成功 ≠ 有内容）。**能力边界显式抛出**：只解 8 位非隔行 PNG，16 位/隔行退出 2；A/B 拒绝不同尺寸（不做裁剪缩放）
- `tools/pixel-proof-mutation.mjs` — 对 pixel-proof 的变异测试（**46 条断言**：**自造各 colorType 与全部 5 种 filter 字节的 PNG 反查解码正确性**——不拿真实截图当基准，那是循环论证）
- `tools/contrast-audit.mjs` — L4 Color 维对比度审计：从 DS Spec tokens 复算「文本 × 表面」矩阵的 WCAG 比值，并把 `accessibility.contrast` 里**手写的每个数字**与复算逐条比对（首次运行即发现随包样例 13 条声称值里 9 条不符）
- `tools/contrast-audit-mutation.mjs` — 对 contrast-audit 的变异测试（36 例：注入 9 类错误 + 边界值/非白背景/非 hex 取值，确认能抓错且不误报）
- `tools/qa-critic.mjs` — L4 Critic 产出校验（134 断言：Schema / 五维评分与 average 实算 / issue 证据须带量或核对动作 / targetLayer 路由 / loop 自洽 / `_evidence` 档位契约 / 跨产物一致）；可校验任意产物（`--report` + `--brief` + `--spec`），`--strict` 让软提示升为失败
- `tools/qa-critic-mutation.mjs` — 对 qa-critic 的变异测试（52 条断言：注入 30+ 类已知缺陷 + 一次全报 + `--strict` 升档 + 自带样例零告警门禁）
- `tools/qa-export.mjs` — **L5 出口闸门**（935 条断言，QA1–QA9：内置最小 draft-07 校验器对清单做**真 Schema 校验** / 导出物存在 / node id 可回读 / 映射完整 / **token `value` 快照复算 + `source` 继承** / 无孤儿 + Export Gate 自洽 / 冻结禁区零修改 / **身份一致** / **可追溯性**）。首次运行即发现 32 处产物与其声明的 DS Spec 对不上，并修掉 Schema 里一处「描述说允许、语义不允许」的条件分支（`if/then` 只能叠加，放宽必须写在 `else`）。**1.3 判据修正（D2/D4）**：QA3 对 `live-build` 档位**不再强制** `figmaFileKey` —— 该凭证是「按 fileKey+nodeId 回读」在 **REST API 上游**里的必要条件，而本管线走 **Bridge 直连插件**（凭 `nodeId` 单键即可）、插件无任何 op 返回它 ⇒ 在本拓扑下它是噪音：本环境永远 1 条 FAIL 且每次收口都要额外解释。现改为「拿不到就如实标 `null` 并在 `_meta.note` 说明缺口」，**静默留空 / 只写空白 / 写成空串**三条仍拦（1 换 1，凭证类断言数不变）
- `tools/qa-export-mutation.mjs` — 对 qa-export 的变异测试（**63 条断言**：注入 30+ 类已知缺陷 + Schema 条件分支正反两例 + **判据修正的正反两面**（如实标 `null` 必放行；无 note / 全空白 / 空串必拦；两分支各带一条断言且断言行可见）+ 基线零告警 + 冻结态「核不了必须说核不了」+ 无 `.git` 路径）
- `tools/qa-install.mjs` — **安装契约校验（L0，100 条断言）**：三模式端到端真跑（真 bridge + mock 插件 + 假 home，逐态对照 Capability Matrix）· 探针只读承诺与 cwd 无关性（行为验证）· 四方文档的用户可见提示语**逐字复算**（不比对「关键词是否出现」，而是拿探针实跑输出当事实源）· 端口五处一致 / localhost 拼写 / `::1` 绑定 / token 路径与跨重启持久性。首次运行即发现 canonical 文档把 OFFLINE 提示截短（与探针实际输出不符）
- `tools/qa-install-mutation.mjs` — 对 qa-install 的变异测试（82 条断言：搭自包含「假安装包」夹具，注入 30 类缺陷 + 基线零告警 + 一次报全部 + `--no-behavior`/`--quiet` 降级路径 + 软档命中非零）。**它抓出过本工具自己的三个错**：缺文件时崩成堆栈、`includes(名字)` 被注释喂饱、以及一条「一直绿但其实从没测到东西」的用例
- `tools/precheck.mjs` — **构建计划开工前预检**（L3）：把你的 op 序列离线过一遍真 `code.js`，一次报出全部静态错误（未知 op / 缺必填 / 参数类型 / 颜色格式 / 效果字段被静默丢弃）；`--live` 可再核对画布已有 id
- `tools/precheck-mutation.mjs` — 对 precheck 的变异测试（75 条断言：注入 13 类错误 + 36 op 全通跑 + B2 在线核对端到端）
- `tools/figma-harness.mjs` — 离线加载真 `code.js` 的共享装置（严格效果桩 + 效果字段两侧契约），供 qa-plugin 与 precheck 共用
- `tools/check-refs.mjs` — 文档引用校验（扫随包 `.md`，命令式引用与反引号路径逐条落地判定，悬空则非零退出）
- `tools/check-refs-mutation.mjs` — 对 check-refs 的变异测试（造含已知错误的样本仓库，断言能抓错且不误报）
- `tools/release-guard.mjs` — **发版一致性守卫（B5 / B6，零依赖）**：六条机械判据 —— `VERSION` 合法 · `CHANGELOG` 含该版本的定版段 · 版本段自上而下单调不增 · 顶部 `-dev` 段版本 **>** `VERSION` · `v<VERSION>` tag 存在 · **tag 落点处的 `VERSION` 与文件一致**（抓「tag 打在 VERSION 还没更新的提交上」）。⚠️ 校的是**序关系不是相等**：`VERSION` 记「最后已定版的版本」，`CHANGELOG` 顶部允许是更大的 `-dev` 段（`CHANGELOG.md` 第 7–11 行写死了这层关系；B5 候选的原始前提「不校两者一致」**本身就是错的**）。取不到 git 时记「未核对」并写明，**绝不折算为通过**；`--strict` 下未核对也阻塞
- `tools/release-guard-mutation.mjs` — 对 release-guard 的变异测试（**39 条断言**：六条判据逐条做坏 + 单条坏不误伤他条 + **反向对照：`VERSION` 与顶部 `-dev` 段不相等但序关系正确时必须全绿**（钉住「校序不校相等」）+ 无 git 时如实记未核对 + `--json` 可直接管道化）
- `tools/layout-audit-readback-probe.mjs` — **跨模块契约探针**（1.3 A1）：用 `figma-harness` 加载**一字未改**的 `figma-plugin/code.js`（`vm`，只读、不碰冻结区），走真 `execute("get-node")` 产出响应，喂给真 `layout-audit --json`，4 条判据钉住「回读形状 ↔ 工具输入」这条跨冻结区契约。与 `layout-audit-mutation.mjs` **互补而不重复**：后者喂**合成树**验「形状对了判得对不对」，本探针喂**真响应**验「真形状是不是就是那样」
- `tools/contract-usage.mjs` — **回读契约的使用矩阵**（1.3 F4 第 3 步）：现场**解析** `code.js` 的序列化段得全部 33 个契约字段，扫 `tools/*.mjs` 的属性访问，三档：用 / 待复核（裸词提及）/ **零引用（=「未使用字段清单」，判据本体）**。判据带牙齿：每个字段要么有消费者、要么在 `UNUSED_OK` 写明「为什么现在不做」，**双向不一致即 exit 1**（防清单静默腐化）。⚠️ 「用」只到 L1（源码有属性访问），不证明在读回读产物 —— `precheck` 读的是计划、`qa-plugin` 是自测
- `tools/contract-usage-mutation.mjs` — 对 contract-usage 的变异测试（**42 条断言**：判据三条逐条做坏 + **反向控制**（删字段必被抓、`--json` 喂文本断言必抛）+ 解析守卫（解析结果异常少即 exit 2））
- `tools/anchor-compare.mjs` — **锚点并置比对的机械装置**（1.3 F3 第 2 步）：锚点品牌 DESIGN.md 声明的 token ←→ 画布回读实际用的 token（色板 RGB 欧氏距 / 字族 / 字阶），五步协议见 `references/anchor-compare.md`。锚点源 = `nexu-io/open-design`（151+ 品牌契约，Apache-2.0，**外部可选、不 vendored**）。判据 J1–J5 全是「装置有没有如实运转」（出处四件套 / 两侧解析非空 / 快照 sha256 可回放），**没有一条是「像不像」** —— 相似度结论属读图项 R11 + 人（H3 零目测评分）
- `tools/anchor-compare-mutation.mjs` — 对 anchor-compare 的变异测试（**43 条断言**：应抓错 8 组（出处缺失 / 空锚点 / 无 token 画布）+ 应放过 + 报告内容 + 纯函数单测（色距已知值 / 字族解析签名：阴影表与断点表不得混进字族））
- `references/lessons.md` — **实测不变量 89 条**（协议 / Plugin API / 数据流 / 测试 / Windows 环境 / 协作；标注哪些已被工具守卫、哪些只能靠纪律）
- `assets/examples/example-health.ops.json` — 一份真实的 L3 构建计划样例（42 步），可直接喂给 `precheck.mjs`
- `assets/style-library/` — 四套 Style Preset（企业后台 / 政务大屏 / 品牌官网 / 现代 SaaS）
- `assets/templates/` — 各类交付物的 JSON Schema（critic-report / design-system-spec / export-manifest / read-image-review）
- `assets/examples/` — 三个行业的完整示例（企业后台 / 美业 AI 试发 / 政务大屏）；另含 `assets/examples/export/files/` 下**一份医疗 App 的导出随包副本** —— 其清单与随包文件已统一改名为 healthcare- 前缀（清单见 `assets/examples/export/example-healthcare-export.json`），以与核心示例 `example-health.*`（美业）区分开，见 `references/lessons.md` #44

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

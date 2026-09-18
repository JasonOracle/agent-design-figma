---
name: agent-design-figma
description: AI UI Designer 五层设计增强 Skill（L0–L5 全链路）。用一句话把自然语言设计需求变成真正画进 Figma 的界面：L0 运行能力探测 → L1 Design Brief 规格化（关键词→风格库匹配、行业映射、信息架构生成、Token 推导、组件预期清单）→ L2 设计系统生成 → L3 自动绘制进 Figma → L4 五维视觉审查与自动修复（最多 3 轮）→ L5 导出 PNG/SVG 与交付清单。触发场景：① 一句话要求设计 App / 后台 / 大屏 / 网站 / SaaS / dashboard / 落地页 / 移动端界面（如"设计一个现代 SaaS 教育管理后台"、"design an AI health app home screen"）；② 要把模糊需求规格化成 Design Brief / 设计系统 / Design Token；③ 要对已有设计稿或截图做审查、评分、评审；④ 要导出 Figma 交付物（PNG / SVG / 组件与 Token 映射清单）。英文触发词：SaaS, dashboard, admin console, IOC, command center, premium, landing page, mobile app, design system, design brief, visual critique, design review, export Figma assets。降级是显式的：桥接或插件不可用时只产出设计文档三件套，并诚实标注未执行层（FULL_MODE / READ_ONLY_MODE / OFFLINE_MODE）。
---

# AI UI Designer — L1 Design Intelligence Layer

## 定位

五层架构中的第一层：**把模糊的自然语言需求规格化为可执行的设计契约**。本层不做任何 Figma 操作（L3 职责）、不生成组件（L2 职责）、不评分（L4 职责）。

> 本文件是技能的唯一入口，L1 五步是主流程；L0 运行能力探测、L4 视觉评审、L5 导出交付同样在本文件内规定，见下文对应章节（执行任何层之前都必须先过 L0）。

```
User Prompt（自然语言）
  → ① 关键词识别（风格路由）
  → ② 行业映射（色彩/组件修正）
  → ③ 信息架构生成（页面清单 + 布局模式）
  → ④ Token 推导（在 Style Preset 基础上做行业化微调）
  → ⑤ 组件预期清单
  → Design Brief JSON（唯一出口物）
```

核心原则：**不是 AI 自由发挥**。每个判断都必须能追溯到明确的映射规则或 Style Preset 字段；规则未覆盖时走「缺省继承 + 显式标注 assumption」。

## Workflow 五步

### ① 关键词识别 → 风格路由

| Prompt 关键词 | Style Preset |
|---|---|
| SaaS、现代、极简、premium、subscription | `premium-saas` |
| 后台、管理、admin、dashboard（企业语境）、中后台 | `enterprise-dashboard` |
| 大屏、IOC、驾驶舱、数字孪生、智慧城市、可视化指挥 | `gov-digital-screen` |

优先级：大屏 > 后台 > SaaS（"高速公路智慧养护大屏"命中大屏，即使同时含"管理"字样）。无命中 → 缺省 `enterprise-dashboard` + 标注 assumption。

### ② 行业映射（在 Style Preset 上做修正）

| 行业 | primaryColor 倾向 | 组件修正 |
|---|---|---|
| 教育 | 蓝紫系（#5A5CF0 / #409EFF） | + 考试/成绩/课程组件 |
| 医疗 | 青绿系（#0FB5AE / #00B578） | + 患者卡/预约/报告组件 |
| 政务 | 红蓝稳重（#1E5EFF / #C7000B 点缀） | + 审批流/公文组件 |
| 交通 | 深蓝底 + Cyan 数据色（#00D4FF） | + 路况地图/设备状态组件 |
| 金融 | 深色高对比（#1A1A2E 底 + 金 #D4AF37） | + 账户/流水/风控组件 |

### ③ 信息架构生成

- 页面清单按平台模板：Web 后台 = 登录/工作台/列表页×N/详情页/设置；移动 App = 首页/核心功能页×N/我的；大屏 = 主驾驶舱 + 子屏×N。
- `layoutPattern` 与 `contentDensity` 从 Style Preset 继承默认值。

### ④ Token 推导

继承 Style Preset 的 `visualSystem` 基线，行业映射仅修正 `primaryColor` 与 `background`；禁止凭空造色值——所有色值必须能在 Preset 或行业映射表中找到出处。

### ⑤ 组件预期清单

`componentExpectation[]`：每项 `{ name, type, priority }`，priority ∈ `P0(必须)/P1(应该)/P2(可选)`。P0 集合来自 Style Preset 的 `coreComponents`，行业修正追加 P1。

## Stage Gate（L1 出口检查）

1. Brief JSON 可通过 `templates/design-brief.json` schema 解析（jq/python json.load 验证）
2. 所有色值/字体/间距有出处（Preset 或行业映射）
3. 未命中规则处均有 `"_assumptions"` 显式标注
4. 用户确认风格方向（一句话级，不逐字段确认）

## 与其他层的关系

- 输出 Brief JSON → L2 消费（生成完整 Token Set 与组件库规格）
- L4 Visual Critic 不达标回写时，修正对象是 Brief JSON 的 `designDirection` / `visualSystem` 字段
- 详见 `references/design-intelligence.md`（完整规则）、`references/design-style-library.md`（四套 Preset）、`references/brief-schema.md`（Schema 定义）

## L2 Design System Layer

L1 的 Brief 就绪后，按 `references/design-system.md` 把它转换成 **DS Spec** —— L3 的**唯一输入**（L3 禁止直接消费 Brief 或自然语言需求）：

```
Brief JSON → ①Token(五类,全带 source) → ②Component 判定 → ③Layout 分区 → ④Build Plan → DS Spec JSON
```

五条硬规则（完整规则见 `references/design-system.md`）：

1. **规则引擎，不是创作引擎**：同一 Brief 必须得到同一 DS Spec；规则未覆盖处写进 `sourceMapping.assumptions`，禁止静默自由发挥。
2. **色值只有三个来源**：Preset 的 `visualSystem` / Brief 显式覆盖（须记进 `briefOverrides`）/ 白名单派生（**仅 RD-1/2/3 + ST-1 四条**）。禁止混色、透明度变体、新增灰阶——preset 只有一个 shadow 就只有一个。
3. **每个 token 必须带 `source`**：五种前缀 `preset:` / `brief:` / `rule:` / `derived:` / `existing-ds:`，可反向审计。
4. **组件判定按序短路**：`reject` → `reuse-core` → `extend` → `create-local` → `generate-core`。P0 必须 100% 覆盖；`reject` 仅限 P1/P2；**存量项目 `generate-core` 必须为 0**；`create-local` 禁止用 `DS/` 前缀。
5. **四件套状态矩阵不可缺**：Button / Input / Table / Card 在 Brief 出现即需完整状态（四类必选态见同文件 §10）。

- 出口校验：`node tools/qa-l2.mjs` —— 四项（Schema / Token 无未知色 / 覆盖与数量 / DS 单源）。**实际运行，不靠目测。**
- 平台布局模板（web-admin / **web-site** / mobile-app / big-screen）：`references/design-system.md` §11
- 字体降级链（Windows 的 Figma 无 PingFang SC，须按链探测）：同文件 §6.1
- **本层是「红线下的次优解」**：文档降方差、脚本拦越界，但**不消除方差**——同输入不同模型仍可能得出不同的合法解。这个边界不得掩盖（同文件 §1）。

## L3 Figma Build Layer

L2 的 DS Spec 就绪后，按 `references/bridge-ops.md` 执行写画布。五条硬规则（完整配方见该文件 §4/§6）：

1. **op 名与参数形状必须照抄文档，不要凭印象构造**。参数形状是契约：`set-effects` 曾因给模糊类效果多写一个 `color` 字段，导致整条 effects 赋值被 Figma 拒绝、招牌的毛玻璃场景全灭。
2. **幂等构建**：本次构建的顶层页框统一命名空间前缀（如 `<产品名> / <页名>`）；正式开工前先 `get-page-summary`，把匹配该前缀的上一轮残留 `delete-node` 清掉——中途失败的构建会在画布留残骸，直接重跑会叠垃圾。
3. **走批量通道**：`POST /v1/batch`（默认 40 步一个 chunk，上限 200）。296 个 op 逐条调用 = 296 次长轮询往返、1~2 分钟纯等待；批量后压到个位数。失败时 `failedAt.step` 就是断点，**从断点续跑，不要整页重建**。
4. **字体按降级链探测**：Windows 的 Figma 没有 PingFang SC / SF Pro，`loadFontAsync` 会直接抛错。按 L1 给出的链依次尝试，首个成功者胜出，并把**实际生效**的字体写进 build log（不要对外宣称用了链首字体）。
5. **分批写入 + 逐批回读**：写入一批 → `get-node {depth:2, detail:true}` 回读该批 → 校验通过再写下一批。`depth` 与 `detail` 是独立参数，看清 §2.3 的语义再取值。

**开工前必过：`node tools/precheck.mjs <计划.json>`**

把**你正要发出去的那串 op**（`{steps:[…]}` / `{ops:[…]}` / 裸数组）先离线过一遍——工具用 vm 跑**真 `code.js`**（装置 `tools/figma-harness.mjs`），所以「必填参数、颜色格式、参数类型、父级可否容纳子节点」这些判定不是我替你复述的规则，而是真源码的裁决。它一次报出**全部**静态错误（`run` 是 fail-fast 的，一次只报第一个，等它报等于等画布炸）。另加 `--live` 可再连 Bridge 核对计划里引用的画布已有 id 是否存在。

两个边界必须知道，不然会误判它：
- **离线查不出「那个 node id 在画布上到底存不存在」**——画布是桩的。这类字面 id 一律列成「待核对」，交给 `--live`；Figma 无事务，做不了真仿真，能做的是核对。
- **`set-effects` 多写的字段会被静默丢弃**（不报错、也不生效）。它跑不出来，所以由 precheck 静态拦——1.1 的 P0 就是这个形态：计划以为给毛玻璃设了色调，实际只拿到一块普通模糊，而画面上不会有任何提示。

## L4 Visual Critic Layer

L3 生成完成后，对每页执行五维审查并形成闭环：

```
Export PNG / 结构化 READBACK → 五维评分（Layout/Color/Consistency/Commercial/Usability）
  → Critic Report JSON → critic-mapping 路由（L1/L2/L3 三选一）
  → 只修复受影响 token/组件/节点 → 重新审查 → ≤3 轮，禁止无限自动优化
```

- **布局审计不许目测**：Layout 维的 gap / 对齐 / 档位 / 越界 / 触控一律用 `node tools/layout-audit.mjs <readback.json> --spec <dsspec.json>` 出违规清单（基于 get-node 实测坐标，可复现、可回归），不要现写临时代码算坐标。读取时用 `get-node {depth:2~3, detail:true}` 取全子树——**默认的 `depth:1` 只回子级的 `id/name/type`（无几何），那些节点一条检查都跑不到**；工具会把「几何覆盖了多少个节点、审到第几层」写进产物的 `geometryCoverage` 并在控制台打一行，**别把「共 1 条」读成「查全了只有 1 条」**（实测同一棵 5 节点树 `{depth:1}` → 覆盖率 **1/2**、`{depth:2}` → **2/5**，两者**浅容器数都是 1** 而漏掉的分别是 1 个与 3 个节点 —— 容器数是代理指标，节点数才是规模；且 `{depth:1}` 的分母不是 5：漏掉的子树**不在响应里**，报出的未参与节点数只是**下界**。一键复核：`node tools/layout-audit-readback-probe.mjs`）。**档位必须从 L2 Spec 派生（`--spec`）而不是手敲**：手敲是「同一份 readback 换个档位就得出不同告警数」的根因（`references/lessons.md` #73），产物里的 `paramSource` / `paramGaps` 记着每个数的来源与取不到的项。
- **效果类参数不许只靠结构回读**：填充透明度、模糊、阴影这类参数的**后果**必须用 `node tools/pixel-proof.mjs <png> [png2]` 在**像素上**验，不能只看回读的属性值。原因是结构回读对它们是**原理性盲区**：`paintToHex()` 只取 RGB、丢掉 `paint.opacity`，于是 `#FFFFFF@100%` 与 `#FFFFFF@72%` 回读出来都是 `["#ffffff"]`——**回读全绿而真正要验的那个数根本没进观测面**（#56）；「模糊一块纯色」数学上仍是那块纯色，参数生效却没有可观察后果（#57）；把节点移进 `clipsContent:true` 的空帧，每一步回读都 `ok:true`、导出却是一张纯色空白图（#59）。单图查「有没有内容」，有对照图时传两张加 `--expect-diff` 查「效果有没有后果」。**能力边界**：只解 8 位非隔行 PNG（16 位/隔行退出 2）、调色板 `tRNS` 忽略、A/B 要求同尺寸（不做裁剪缩放）。
- **对比度不许手写**：Color 维的 WCAG 比值、以及 DS Spec `accessibility.contrast` 里已经写下的每个数字，一律用 `node tools/contrast-audit.mjs <spec.json>` 复算。它做两件事：① 从 tokens 推导「文本 × 表面」矩阵给出精确比值与 AA/AAA 档位；② 把每条**声称值**与复算结果逐条比对，并交叉验证声称里写的 hex 与 token 实际值是否一致。**手写的对比度数字不可信**——随包三份样例首次复算即发现 13 条里 9 条与 WCAG 公式不符（偏差 0.17~1.64）。判定用未舍入原值（`4.478` 显示成 `4.5` 也不许当通过）。
- **读图评审是有图环境的必选项（1.3 F3①）**：`_evidence.mode = structured+vision` 时，**除逐条可回放观察外，还必须按 `references/read-image-checklist.md`（14 条：E1 语义性缺失 R1–R4 + 外部判据的读图内核 R5–R8 + 自有增益项 R9–R14）逐条留痕**，落盘 run 目录一份 `read-image-review.json`（Schema：`assets/templates/read-image-review.json`）。**能读而不读 = 违规**；无读图能力则照常走通用档并在 `_evidence.unassessed` 如实列缺——两句话方向相反、各挡一种滥用。注意：清单是**读图项，不是闸门项**（H3 零目测评分），不得写脚本冒充机器判定。
- 评分模型与 Loop 规则：`references/visual-critic.md`
- issue → 层路由与回写约束（CR-1~5）：`references/critic-mapping.md`
- Report Schema：`assets/templates/critic-report.json`（evidence 必填、targetLayer ∈ L1/L2/L3）
- few-shot（覆盖三种循环结局）：`assets/examples/example-{saas,health,highway}/critic-report.json`
  - saas = 企业后台 Round 1 一次 PASS / health = 美业 AI 试发 App「AI 型衣」3 轮收敛 PASS / highway = 政务大屏 3 轮仍不达标 STOP_MAX_LOOP。**注意 `health` 这条是美业（品牌紫 `#5A5CF0`），与 L5 导出包里那份「医疗 / AI 智能健康管理」的随包副本不是同一个项目**——同名不同物，见 `references/lessons.md` #44
- **出口校验不许人工目测**：`node tools/qa-critic.mjs` 校验 critic-report（**134 条断言**，QA1–QA8：Schema 契约 / 五维评分与 `average` 实算 / issue 证据须带**量或核对动作** / targetLayer 路由 / loop 自洽 / `_evidence` 档位契约 / 跨产物一致）。带 `--report` + `--brief` + `--spec` 可校验用户自己的产物；`--strict` 把软提示升为失败（样例自身走这一档）。**报告里的数字会被复算**——C3 上线即发现随包三份 critic-report 的页面名、引用的 token 色值、档位表与 `minFontSize` 全都有与 DS Spec 对不上的地方（同 `contrast-audit.mjs` 的教训：写在产物里的数字会被下游当事实复用）。

## L5 Export Layer

L4 Critic PASS 后，把设计结果转换为完整可交付设计资产：

```
Prompt → L1 Brief → L2 DS Spec → L3 Figma Build → L4 Critic（≥8 PASS）→ L5 Export
```

**Export Gate（进入导出的硬性前置，全部满足才允许 live-build 导出）**：
1. L3 出口检查 QA1–QA5 全绿（0 FAIL，逐条核对）
2. L4 Critic average ≥8 且无单项 <7（action=PASS）
3. Freeze protocol passed（冻结文件零修改）
4. Build IDs 完整（build-ids 快照 + rootNodeIds 可回读）

五类输出：PNG（@1x/@2x 展示/评审/AI 视觉理解）、SVG（图标/Vector/页面级矢量）、Figma JSON（Node Tree/Geometry/AutoLayout/Instance/TokenReference）、Design Specification（Brief/DS Spec/Build Plan/Critic Report 随包）、Frontend Mapping（组件映射矩阵 + Token→CSS Variable + Layout 规则）。

- 总体架构与映射规则：`references/export-mapping.md`
- 出口协议 Schema：`assets/templates/export-manifest.json`（所有路径可追溯；dsToken 可沿点路径回溯 DS Spec）
- 组件/Token 映射规则（A 直接/B 组合/C 不可自动）：`references/export-mapping.md`
- few-shot：`assets/examples/export/example-{saas,health,highway}-export.json`
  - saas = 真实 live-build（真实构建产物回填）/ health = 真实 live-build（真实导出 PNG+SVG）/ highway = design-phase（critic 7.7 未过 Gate，exports 为空规划清单——Gate 规则的活教材）
  - ✅ **`health` 的名实不符已在 1.2 收尾解决**：核心示例仍是 `example-health.json`/`.dsspec.json` 的「AI 型衣 / 美业」；导出包的随包副本已统一改名为 healthcare- 前缀（清单见 `assets/examples/export/example-healthcare-export.json`，内容为「AI 智能健康管理 / 医疗」）。**两者不再共用一个前缀**（原问题见 `references/lessons.md` #44）——但出口校验仍只认清单自己声明的 `source.*`，不要与核心示例混读。
- 出口校验：交付物检查清单 QA1–QA9（Schema 真校验 / 文件存在 / node id 回读 / 映射完整 / Token 回溯 + **value 快照与 source 继承** / 无孤儿 + Export Gate 自洽 / 冻结零修改 / **身份一致** / **可追溯性**）＝ `node tools/qa-export.mjs`（**已落地**；仓库自带样例走 `--strict`，即零告警门禁）。**已经落地的层一律用脚本，不得再拿「人工核对过」当校验过的证据**：L2 = `node tools/qa-l2.mjs`、L4 = `node tools/qa-critic.mjs`、L5 = `node tools/qa-export.mjs`。⚠️ **QA3 的 `figmaFileKey` 自 1.3 起不强制持有**（判据修正 D2/D4）：本管线回读走 Bridge 直连插件、凭 `nodeId` 单键即可，且插件无任何 op 返回它 —— 拿不到就**如实标 `null` 并在 `_meta.note` 说明缺口**，而「静默留空 / 只写空白 / 写成空串」三条照旧拦下（换判据，不是删判据）。

## L0 Runtime Capability（任何层执行前必须先跑）

**入口**：`node <skill 根目录>/tools/runtime-check.mjs` → 输出默认落在 `<skill 根目录>/.vibe/runtime-capability.json`（路径由脚本自身定位，**任意 cwd 都能跑**）。输出的 `version` 字段即当前技能版本——**每份交付物都应带上它**，让"这份稿子由哪个版本产出"永远可答（版本变更记录见 `CHANGELOG.md`）。

在任何层开始前先探测环境能力，按 mode 路由（完整矩阵见 `references/runtime-capability.md`）：

| mode | 条件 | 执行范围 |
|---|---|---|
| FULL_MODE | Bridge 插件已连接（figmaWrite） | L1 → L2 → L3 → L4 → L5 全链路 |
| READ_ONLY_MODE | 仅读取型 MCP（figmaRead） | L1 → L2 → Build Plan JSON；提示"当前环境只有读取能力，需要安装 Figma Bridge 才能自动绘制" |
| OFFLINE_MODE | 均无 | 仅生成 Brief / DS Spec / Build Plan 设计资产 |

注：FULL_MODE 下 `figmaRead` **同样是 true**——Bridge 自带 `get-page-summary` / `get-node` / `export-node` 读能力（见 `details.readSources`）。读能力不是"只有 MCP 才算"，别把它误读成环境残缺。

铁律：未跑的层不得假装跑过（交付物标注 mode 与降级原因）；探针只读，零新协议、零 Bridge/Plugin 修改。安装指南：`SETUP.md`（普通用户 5 分钟上手），架构边界：`README.md`。**安装体验不许目测**：改用 `node tools/qa-install.mjs` 出安装契约校验（三模式真跑对照 Capability Matrix / 只读承诺 / cwd 无关性 / 四方文档的提示语逐字复算 / 端口与 token 事实），它会真起一份 bridge 走一遍；`SETUP.md` Step 1–3 的人工实走仍要做，但**结论以脚本为准**。

## few-shot 示例

`assets/examples/`：`example-saas.json`（SaaS 教育后台）、`example-health.json`（AI 发型 App，美业健康类）、`example-highway.json`（河南高速智慧养护大屏）。Agent 生成新 Brief 前应先读对应行业示例对齐粒度。

## 交付验收（D1）

跑完一次完整链路后，按 `references/acceptance-criteria.md` 逐闸门验收。它把 D1 的三条**承诺**（零人工补丁 / 零失效引用 / 零目测评分）换成**机械判据**——理由是行为承诺无法验收：跑完之后产物上没有痕迹证明执行者当时守没守规矩。

- **先定档再判**：`node tools/runtime-check.mjs` 定出 `FULL_MODE` / `READ_ONLY_MODE` / `OFFLINE_MODE`，三档可判范围不同；**低档不得冒充高档**（离线档产物不得出现 `liveBuild` / `nodeId` 已回读 / `figmaFileKey` 非 `null`）。
- **H1 零人工补丁**的判据不是「手有没碰过文件」（不可观测），而是**产物里每个数字要么算得出、要么指得出源**——这条恰好是 C1 / C3 上线时抓到「被编造的数字」用的同一组断言。
- **H2 零失效引用**分三个时刻：写文档时 `node tools/check-refs.mjs`；发计划前 `node tools/precheck.mjs <plan>`（真 `code.js` 当契约）；有图时再加 `--live`。无图环境下 **记「未核对」，不得折算为通过**。
- **H3 零目测评分**：L4 每份报告过 `node tools/qa-critic.mjs`（QA4 证据判形状 / QA6 有 `critical` 禁止 PASS / QA7 `structured-only` 下 `unassessed` 必须非空 / QA8 引用的量与 Spec 对得上），**Color 维**另过 `node tools/contrast-audit.mjs`，**Layout 维**另过 `node tools/layout-audit.mjs --spec`，**材质/效果维**另过 `node tools/pixel-proof.mjs`。**四维各有裁判，缺一维就只能目测该维。**
- **留痕**：验收记录表要**粘贴工具输出的汇总行与退出码**——「通过」两个字不算留痕，因为一个永远返回 0 的脚本也能让人写出「通过」。

一次跑完全部闸门（`<run>` = 本次构建的产物目录）：

```bash
node tools/runtime-check.mjs
node tools/qa-install.mjs
node tools/qa-l2.mjs       --spec <run>/dsspec.json --brief <run>/brief.json
node tools/contrast-audit.mjs    <run>/dsspec.json
node tools/precheck.mjs <run>/build-plan.json
node tools/qa-critic.mjs --report <run>/critic-report.json --brief <run>/brief.json --spec <run>/dsspec.json
node tools/layout-audit.mjs <run>/readback.json --spec <run>/dsspec.json
node tools/pixel-proof.mjs <run>/l4-shot.png --expect-content 0.01
node tools/qa-export.mjs --manifest <run>/export-manifest.json
node tools/check-refs.mjs
node tools/release-guard.mjs        # 发版一致性（B5/B6）：打 tag 前后各跑一次
```

**契约探针**（不是每单都跑，改过回读形状 / `layout-audit` 输入契约后必跑）：

```bash
node tools/layout-audit-readback-probe.mjs   # 真 code.js 的出参 ←→ 真 layout-audit 的入参（4 判据）
node tools/contract-usage.mjs                # 契约使用矩阵：33 字段 × 谁在读；零引用清单 + 双向判据（1.3 F4 第 3 步）
```

**锚点并置比对**（L4 评 Commercial「商业产品相似度」前必跑 · 1.3 F3 第 2 步）：

```bash
node tools/anchor-compare.mjs <run>/readback.json --anchor <快照.DESIGN.md> \
  --source <锚点原始URL> --license Apache-2.0   # 色板/字族/字阶差值，可回放到快照 sha256
```

> 五步协议与边界：`references/anchor-compare.md`。装置只产**机械证据**（判据 J1–J5，
> 全是「装置有没有如实运转」）；「像不像锚点」属读图项 R11 + 人（H3 零目测评分）。
> 选锚是人的判断（按产品定位选同类品牌），装置不替人选。

> ⚠️ **本清单曾漏列 `layout-audit` 与 `pixel-proof`（2026-09-17 补齐），同日又补了 `release-guard`；
> 2026-09-18 登记 `contract-usage`（契约使用矩阵）与 `anchor-compare`（锚点并置比对）。**
> L4 四个维度各有裁判，少一条命令即等于那一维退回目测；**收编新工具必须同步登记进本节与
> `references/acceptance-criteria.md` §5**（`lessons.md` #82 的同族错误：工具做出来但没人知道要跑它）。
> `release-guard` 校的是**序关系**（`-dev` 段必须大于 `VERSION`），不是「两者相等」——
> 后者是个不成立的前提，见 `CHANGELOG.md` 第 7–11 行。
> `layout-audit` 的档位**从 L2 Spec 派生**（`--spec`），勿手敲 —— 手敲会让「同一份数据得出不同告警数」（#73）。
> `layout-audit` 报告的 `geometryCoverage` 要**看分母**：`{depth:1}` 默认回读下**绝大多数节点一条检查都没跑到**，
> 此时「共 N 条」不是「查全了只有 N 条」，而是「没查」。深审请让 Bridge 回 `{depth:3, detail:true}`。

## 校准实测（D2）

D1 回答「这次跑通了吗」，D2 回答「跑通一条链路的成本与盲区是什么」。跑**两次**不同行业 / 复杂度的真实构建（须 FULL_MODE），产物不是设计稿而是**数据**：每道闸门拦下了什么、拦不下的又是什么、手工成本多高。

**执行手册见 `references/d2-calibration.md`**（前置条件 / 选题原则 / 产物目录约定 / 逐闸门记录字段 / 成本记账 / 翻车点归因三档）。三条要点：

- **翻车点是数据，不是失败**——D2 要的就是翻车点，因为只有它们能校准「问题全是隐式知识」这个从单次实测推出的判断。
- **预检的收益要量化**：把「第一次写错的计划」与「修好的计划」分别跑 `precheck`，用 `failedAt.step` 算出「若不预检，会在第几步炸」。
- **D1 §8 那个待定的薄编排器，判据就在 D2 §3**（事先定好的成本阈值），别等跑完才想怎么算。

## 实测不变量（动手前先读）

`references/lessons.md` —— **89 条**实测踩坑验证过的不变量（协议 / Plugin API / 数据流 / 测试 / 环境 / 协作）。**L3 写画布前、L4 回读前，以及每一次「这次为什么翻车」的归因，都先查这里**：多数翻车不是新问题，是踩过的坑换了个壳。文中标注了哪些已被工具守卫（⚙️）、哪些仍只能靠纪律（📏）——**没被守卫的部分不得假装被守卫**。
**外部判据要收编时先过筛**：`references/design-criteria-intake.md` 的四道筛（静态？→ **前提是否成立？** → 可判定？→ 检查还是配方？）—— 顺序不可换，且 **S1.5「前提是否成立」必须排在「可判定」之前**，否则会得到一个**永远报 0 条的检查**（那会被读成「查过没问题」）。该文的 §1.5 还有一张 **`get-node` 回读契约表**：**写任何新检查类之前先查它** —— 判据完备、值也齐全，只要**字段不在契约里**，检查就**结构性永远报 0**（`lessons.md` **#87**；处置是**提需求补字段，不是降判据**）。这张表现在有**工具直接出清单**：`node tools/contract-usage.mjs` —— 零引用字段就是「不用筛来源也能收编检查类」的候选池（`design-criteria-intake.md` §7）；**反过来，把字段做进判据前先确认它有信息量**：`layoutSizing` 在无 auto-layout 的树上恒为常量，能回读 ≠ 能当判据（第三态）。


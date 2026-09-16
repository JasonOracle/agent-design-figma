# Changelog

本 Skill 的版本变更记录。版本号基线：**对外契约** = `SKILL.md` 的五层规则 + `bridge/` 与 `figma-plugin/` 的 op 面；改动这两者的行为即需升版本。

格式参考 Keep a Changelog；版本号遵循语义化版本。

---

## [1.2.0-dev] — 未发布（代号「可信版」）

**主题**：让「跑一次完整链路」从**可能翻车**变成**可预期、可拦截、可复现、可验收**。**零能力新增，纯还债。**

完整范围见 `1.2-plan.md`。

### 已完成

- **A2 修失效引用** —— 全量核查后为 **12 处**（`SKILL.md` 4 / `critic-mapping.md` 3 / `visual-critic.md` 2 / `export-mapping.md` 1，另 2 处是把 Build Plan 误当独立文件），全部指向一套从未随包发布的 QA 脚本。全仓库 63 处文件引用扫描：真缺失 **0**。
- **A3 版本治理** —— 新增 `VERSION`（`1.2.0-dev`）与本文件；`tools/runtime-check.mjs` 输出增加 `version` 字段，路径无关（任意 cwd 可跑）。
- **A1 L2 契约文档** —— 新增 `references/design-system.md`，填补链路唯一的无文档层：五段流水线、三条不变式、五类 Token、白名单派生（RD-1/2/3 + ST-1）、组件决策矩阵（CD-1..4）、四件套状态矩阵、四平台布局模板、QA 四项判据。`SKILL.md` 补 L2 章节。上游可搬运部分已适配，另补上游缺失的 `web-site` 平台模板与字体降级链。
- **C3（部分）L2 校验脚本** —— 新增 `tools/qa-l2.mjs`，把 L2 出口校验从「人工照清单核对」变成实际执行。四项检查共 **47 项断言**（Schema / Token 无未知色 / 覆盖与数量 / DS 单源），零依赖。除校验自带 few-shot 外，支持 `--spec` + `--brief` 校验**用户自己的产物**（这是 D1「零目测评分」的前提：校验必须能作用于真实产物，而不只是仓库示例）。另附 `tools/qa-l2-mutation.mjs` —— 逐项注入 16 个已知错误确认校验会报警：**只跑一次全绿不能证明校验有效**，一个永远返回 PASS 的脚本也能全绿。
- **A4 引用校验器** —— 新增 `tools/check-refs.mjs`：扫全部随包发布的 `.md`，把「命令式引用」（`node` 后跟脚本路径）与「反引号路径」（`` `references/y.md` ``）逐条解析，四条判定（仓库根 / 文档同级 / 全仓库同名 / glob）全不中即判悬空，报警并非零退出。治的是 12 处失效引用的**机制性根因**——上游把「检查文档引用」列为人工勾选项，勾了却没做干净；人工项治不住，机械闸门才治得住。三类豁免**均写明理由**：① 运行时产物（`.vibe/` 下的探针输出，本来就只在跑完之后才存在，引用它属于描述产出位置）；② Token 点路径（`tokens.radius.md` 是 radius 下的 md 档、不是 markdown 文件；判据收紧到「无 `/` + 至少 3 段 + 首段是已知对象根」，故真文件 `manifest.json` 不被误豁免）；③ 角度占位符（`<skill 根目录>/tools/runtime-check.mjs`、`<readback.json>` 先剥占位符段，剥完以 `/` 开头的按仓库根锚定）。**现仓库实测：140 条引用全部落地，零误报。**
- **A5 实测不变量清单** —— 新增 `references/lessons.md`：上游七个阶段沉淀的 **30 条**实测踩坑不变量（协议 / Plugin API / 数据流 / 测试 / Windows 环境 / 协作），按本仓库命名与实现适配，并逐条标注**已被工具守卫（⚙️）还是只能靠纪律（📏）**；另补本仓库 1.1–1.2 新得的 8 条（安装副本与开发仓库漂移、校验器判断顺序本身是缺陷来源、校验器必须配变异测试、人工勾选治不住文档脱节、打包排除项会悄悄删掉质量资产、筛选要用正向形状而非反向排除、算得出来的数字必须配复算、判定阈值不许先舍入），共 **38 条**。`SKILL.md` 增加入口段，指明「动手前先读」。
- **B1 构建计划静态预检** —— 新增 `tools/precheck.mjs`：把「画到一半才发现参数错」提前到开工之前。输入是**你正要发出去的那串 op**（`{steps:[…]}` / `{ops:[…]}` / 裸数组三形状等价）。**契约的事实源是真 `code.js` 本身**——用 vm 离线跑一遍（装置抽成 `tools/figma-harness.mjs`，与 `qa-plugin` 共用同一份严格效果桩），而不是再抄一份 op 形状表（抄一份就多一处将来必然腐坏的副本，而"必填参数 / 颜色格式 / 参数类型 / 父级可否容纳子节点"的判定本来就写在 `code.js` 里）。判定分三档且**边界如实打印**：结构错误（离线可判定）、契约错误（真源码的裁决）、**装置缺口**（桩没覆盖到，不算产品缺陷，单独列出提示补桩）。**逐步试跑而非整批提交**——`run` 是 fail-fast 的，一次只报第一个；预检必须一次报全。
- **B2 在线引用核对**（`precheck … --live`）—— 开工前连 Bridge，把计划里引用的画布已有 id 逐个用 `get-node` 问一遍，缺哪个就报「**哪一步的哪个 id**」。**离线查不出这件事**（画布是桩的），所以字面 id 一律归入「待核对」而不是错误；装置还会按参数名给出期望类型提示（`componentId` → COMPONENT），免得凭空撞出 `NOT_A_COMPONENT` 这种假错误。边界照写进输出：**这是核对，不是仿真**——Figma 无事务，做不到「先跑一遍再回滚」。
- **离线装置的完整性被测试锁住** —— `tools/precheck-mutation.mjs`（63 条断言）：13 类注入错误 + 「一次报全部」（防退化成 fail-fast）+ **36 个 op 全通跑**（0 错误 0 装置缺口，等价于"装置对全部 op 都不缺件"）+ B2 端到端（真 Bridge + mock 插件：id 存在 → 通过 / id 缺失 → 报出具体步骤与字段 / 插件掉线 → 失败且**不得**说"全部存在"）。
- **`assets/examples/example-health.ops.json`** —— 一份真实规模的 L3 构建计划样例（42 步，覆盖建帧 / 建文 / 建组件 / 实例 / 效果 / 读回 / 字面 id 引用），可直接喂给 `precheck.mjs`，也是 B1「对合法计划零误报」的基准样本。
- **C1 对比度审计（Color 维）** —— 新增 `tools/contrast-audit.mjs`：从 DS Spec 的 `tokens.color` 复算「文本 × 表面」矩阵的 WCAG 比值与 AA/AAA 档位，并把 `accessibility.contrast` 里**手写的每条声称值**与复算逐条比对，另交叉验证「声称里写的 hex」与「token 实际值」是否一致（抓「token 改了、声称没跟着改」）。判据刻意为硬/软两档：只有正文（`text.primary`/`regular` ≥ 4.5:1）与「声称值必须复算得上」进退出码；辅助/占位文本、品牌色、状态色、边框色的组合只作**信息项**——DS Spec 并不声明「某 token 用在哪个背景上」，把这些组合一律当硬性要求等于工具自己发明用法、凭空造出违规（如 `example-highway` 的 `#00D4FF` 是高亮色而非按钮填充，要求白字达标就是假的）。判定一律用**未舍入**原值（`4.478:1` 显示成 `4.5:1` 也不许当通过），贴阈值时打 `⚠边界`；非 `#RRGGBB` 取值记为「无法计算」并计入退出码——**算不出不能当通过**。配套 `tools/contrast-audit-mutation.mjs`（**36 例**，含边界灰 / 非白背景 / 非 hex 取值 / 多份聚合）。
- **C2 L4 证据链两档化** —— `visual-critic.md` 新增 §1.6「证据两档制（通用 / 增益）」：**通用档**（所有环境，结构化回读的实测值）恒须产出；**增益档**（只有能读图的 Agent，导出 PNG + 逐条观察）为附加，**不得替代**通用档——**读图是增益、不是前提**。给出逐维分档表（如 Commercial 的「商业产品相似度 40%」属增益档、其「模板感」在通用档用结构化代理判定：`Frame 123` 式默认命名 / lorem 文本 / `#D9D9D9` 占位块），并立下四条硬约束：三维通用档分数恒须产出 · **未评估项不得当作通过**（`_evidence.unassessed` 为空才允许声称完整评估）· 增益档观察必须具体可回放 · `_meta.reviewer` 须写明档位。**关键的一条是权重处理**：通用档下无法评估的检查项要**剔除权重并对余项重新归一化**，因为把「没看」按满分或零分计入**都是在编**（前者放过缺陷，后者凭空扣分）。`critic-report.json` 增开可选 `_evidence` 字段（`mode` / `unassessed` / `visionObservations`）承载该规则——顶层本就是开放对象，故三份既有样例仍合法。§4「审查执行方式」的前两条同步改写为两档的执行规则。
- **C3·qa-critic L4 产出校验** —— 新增 `tools/qa-critic.mjs`（**134 条断言**），把 L4 出口校验从「人工照清单核对」变成实际执行。**八组检查**：QA1 Schema 契约（含 `_evidence.mode` 枚举）· QA2 顶层字段 · QA3 五维评分与 `average` 实算（half-up 一位小数，**用未舍入原值判等**）· QA4 issue 必备证据（`evidence` 须含**量或核对动作**）· QA5 `targetLayer ∈ {L1,L2,L3}` · QA6 Critic Loop 自洽（`round ≤3` / `maxLoop==3` / `action` 与分数互推 / **有 `critical` issue 时禁止 PASS**）· **QA7 证据档位契约**（把 C2 的 `_evidence` 从「可选」升为「必填 + 校验」，并立一条可推导的硬判据：`mode=structured-only` 时 `unassessed` **必须非空**——§1.6 分档表里 Commercial「商业产品相似度 40%」在结构化档不可判定，声称「零未评估项」即把没看当看过）· **QA8 跨产物一致**（`project` ↔ `brand.name` ↔ `product.name`、`page ∈ Brief IA`、`_meta.inputs` 路径存在，以及**证据里引用的每个可解析量都要与 DS Spec 对得上**）。除校验自带 few-shot 外支持 `--report`（可配 `--brief` / `--spec`）校验**用户自己的产物**。判据同样刻意分**硬 / 软两档**：`issue.evidence` 是自由文本，从中抽出的量只能当交叉核对提示，记为 `WARN`；`--strict` 可把 `WARN` 升为失败（仓库自带样例走这一档，等于给「样例自身必须干净」装了门禁）。配套 `tools/qa-critic-mutation.mjs`（**51 条断言**：注入 30+ 类已知缺陷 + 一次全报 + `--strict` 升档 + 基线零告警）。

### 修复

- **`design-system-spec.json` 的 `stylePresetId` 枚举缺 `web-marketing`** —— 1.1 新增的第四套 Preset 一直无法通过 DS Spec 校验。
- **派生色校验可被绕过**（移植上游脚本时发现的逻辑漏洞）—— 上游先判「值是否在 preset 色板内」、再判是否派生，导致**派生 token 的值只要填成任意一个色板色就能蒙混过关**（`hover` 错填 `#000000` 或 `#FFFFFF` 均不报警）。改为：带 `derived:` 前缀即强制走公式复算。
- **`check-refs.mjs` 的路径正则漏掉点目录**：首字符类不含 `.`，导致 `.vibe/runtime-capability.json` 这类**点目录开头**的路径整条连不上——既不报错也不进豁免，等于运行时豁免规则空转（真实仓库里「豁免 运行时=0」即是证据）。已由变异测试的「豁免计数非零」断言守住。
- **A4 上线即抓到一处真实问题**：`references/lessons.md` 初稿把**不存在**的 package.json 加了反引号。按本仓库文档惯例，反引号包住路径即声明「仓库内有此文件」，故改的是文档措辞（改为叙述 npm 的通用行为），不是放宽校验器。
- **离线装置"多给属性"会凭空造出契约错误**：`figma-harness.mjs` 起初给**所有**节点都补上 `layoutMode: "NONE"`，但真实 Figma 里 TEXT / RECTANGLE **没有** `layoutMode`（那是 AutoLayoutMixin 的属性，只有 FRAME / COMPONENT / COMPONENT_SET / INSTANCE 才实现）。于是 `set-layout-sizing` 里 `"layoutMode" in node` 这个判断被误触发，把合法的 `FILL` 判成 `NO_AUTO_LAYOUT`。**桩"多给属性"和"少给属性"一样危险**——已改为按类型（照 mixin 划分）给属性，并加断言锁住。
- **`precheck --live` 会把"没查成"说成"查过了"**：核对里出现意外响应（超时 / 掉线 / 未领取）时，它仍然打印「外部引用全部存在于画布」。已改为：只有**零意外响应**时才敢下"全部存在"的结论，否则一律判未通过。
- **`qa-l2` 挑 Brief 用的是反向排除法**（「`example-` 开头且**不是** `.dsspec.json`」）——本轮往 `assets/examples/` 加了一份 L3 构建计划样例 `example-health.ops.json`，它立刻把这个非 Brief 当 Brief，报出「同名 Spec 缺失」。**靠「排除已知的坏东西」写的规则，会在出现未知的新东西时失效**。已改为正向形状 `^example-[^.]+\.json$`。已记入 `references/lessons.md` #36。
- **三份样例的对比度声称值有 9 条是错的（C1 上线即抓到）** —— DS Spec 的 `accessibility.contrast` 要求逐条给出对比度结论，但那些数字从来只有人写、没人算。`contrast-audit.mjs` 首次运行即发现 13 条声称值里 **9 条**与 WCAG 公式不符，偏差 0.17~1.64 且**方向不一致**（不是同一个错误公式，是根本没算）；其中 `example-saas` 的 `text.regular` 声称 `7.0:1` 实为 `6.11:1`（若按 AAA 7:1 判即翻盘）、`text.secondary` 声称 `4.2:1` 实为 `3.08:1`。更值得记的是：这个错值还被抄进了 `design-system-spec.json` 的 `contrast` 字段描述，**成了下游的「参考事实」**——文档里的数字会被当事实复用。已按复算值修正三份样例（并补上此前自相矛盾的标签：`example-highway` 的 `3.3:1` 却标 `FAIL-TEXT`，实为 `PASS-LARGE`）与 schema 描述，并从 schema 描述里明确了标签词表（`PASS` ≥4.5 / `PASS-LARGE` ≥3 / `FAIL-TEXT` <3），此前该词表无任何文档定义。
- **三份 critic-report 的「实证数字」全都有与 DS Spec 对不上的地方（C3·qa-critic 上线即抓到，同 C1 那类病）** —— ① `example-highway` 的 `page` 写 `主驾驶舱`，而它自己的 Brief 里 IA 页面叫 `养护总览驾驶舱`（Schema 明文要求 `page` 取自 `brief.informationArchitecture.pages[].name`、逐页出报告）；② 同一份报告把 `text.secondary` 写成 `#6B7A99`、卡面写成 `#10224A`、对比度写成 `3.2:1`，而 Spec 里该 token 是 `#5A7CA6`、`surface.card` 是 `#0F2547`、实算 `3.5:1`——**三个数字没一个对**（结论「不达标」倒仍成立）；③ 它引用的档位写 `4/8/12/16/24/32` 与 `14/16/20/24/32`，而大屏 preset 声明的是 `8/16/24` 与 `14/20/22/26`（抄的是 Web 后台那套），连修复建议「对齐 12px」「归档到 TY 32 档」也指向不存在的档；④ `example-health` 一条 issue 声称「12px caption 低于 `accessibility.minFontSize=14`」，而 Spec 里 caption 是 13、`minFontSize` 是 **11**——按真实数据这条 issue 根本不成立。**写在产物里的数字会被下游当事实复用，而它们从来只有人写、没人算。** 已逐一按 Spec 修正三份样例，并补上此前缺失的 `_evidence` 档位声明。
- **`qa-critic` 自己的「实测痕迹」判定太松（写变异测试时被反例抓出）** —— 照搬上游的关键词袋 `["px","#",":","%","档","级","分",…]`，其中「级」「分」会命中「不够**高级**」「大部**分**」，于是「整体观感不够高级」这种**纯观感话术**照样通过——而它正是 `critic-report.json` 明令禁止的（`suggestion` 不得写「不够高级」）。已改为判**形状**：要么带量（`#RRGGBB` / 带单位的数字），要么带明确的核对动作词（实测 / readback / 复算 / 逐节点 / 档位…），并由变异测试的反例用例钉住。已记入 `references/lessons.md` #40。
- **B2 的「插件掉线」用例在赌时序（偶发假绿）** —— 该用例原本是「停掉 mock 轮询 → 睡 300ms → 断言核对失败」，但 Bridge 判定插件在线用的是 **45s** 的 stale 窗口、mock 的在途长轮询最长 500ms，300ms 后它仍可能把停摆前的最后一条命令答掉；同一份代码连跑两次会一绿一红。已改为让 mock 在停摆后**连在途命令也不回**（把「不应答」变成确定性事实，而不是等更久），并另补一条**从未连接**的离线路径（起一台全新 Bridge，`/health` 直接说未连接 → 当场判失败、不发命令）。已记入 `references/lessons.md` #39。

### 待办

- C3 其余两个脚本，**各自须配变异测试**：`qa-export`（L5 闸门 —— 上游 237 行 / 652 断言，覆盖 Schema · 文件存在 · node id 回读 · 映射完整 · Token 回溯 · 无孤儿 · 冻结零修改；**这是 L5 Export Gate 目前唯一的空规则**）· `qa-install`（安装契约 —— README / SETUP / USER_GUIDE / 探针四方一致，上游 109 行 / 56 断言）。
- D1 硬验收 · D2 两次实测校准（B1/B2 的预检效果应在 D2 里被真正用上并记数据）

> 本版本尚未发布，完成后补齐具体条目。

---

## [1.1.0] — 2026-09-16

基于一次完整链路真实运行（移动端官网，4 页 / 296 ops / 2 轮 Critic）的修复批次。提交 `d5a4070`..`16df195`。

### 修复

- **`set-effects` 毛玻璃必崩**：模糊类效果被无条件写入 `color` 字段，新版 Figma Plugin API 严格校验整条拒绝（`Unrecognized key(s) in object: 'color'`）——`BACKGROUND_BLUR`（毛玻璃唯一路径）从未真正可用。改为按类型构造字段。
- **`nodeInfo` 的 `depth` 失效**：`depth` 只在同时传 `detail:true` 时才生效，`get-node {depth:2}` 的孙级永远是不含几何的壳。改为 `depth>1` 即递归，`depth:1` 形状不变。
- **探针 `figmaRead` 误报**：只认 MCP 配置，导致 FULL_MODE 下输出 `figmaWrite:true / figmaRead:false` 的自相矛盾结果。改为 `bridge读 ∥ mcp读`。
- **字体写死 `PingFang SC`**：Windows 的 Figma 无此字体，`loadFontAsync` 直接抛错。三套 Preset 与 L1 规则改为**降级链**（PingFang SC → Microsoft YaHei → Inter 兜底）。
- **安装体验**：clone 命令改 HTTPS（原 SSH 地址要求先配 SSH key）；技能目录 `.workbuddy/skills` 与 `.codebuddy/skills` 并列为主安装位；自检命令改绝对路径。

### 新增

- **`POST /v1/batch` 批量通道**：296 个 op 的 296 次长轮询往返压到 8 次；支持 `onError=abort|continue`，失败时 `failedAt.step` 即断点、可续跑。
- **`references/bridge-ops.md`**：36 个 op 的参数形状、`run` 批量语法（`@last`/`$name`）、`depth`/`detail` 语义、错误码、效果字段对照表。**此前仓库内 op 文档为 0**。
- **`tools/qa-plugin.mjs`**（21 项）：用 `vm` 加载真实 `code.js` + 严格效果校验桩，离线给插件做回归测试。
- **`tools/qa-bridge.mjs`**（13 项）：起真实 Bridge 子进程 + mock 插件走完整长轮询链路。
- **`tools/layout-audit.mjs`**：L4 布局审计八类检查（spacing / padding / radius / font-size / alignment / overflow / baseline / touch）。

### 规则

- **avoid 仲裁**：确立「Prompt 显式点名 > Preset avoid」，覆盖时从 avoid 剔除 → 写 `style.avoidOverrides` → 同步传播 L2/L4 共用一份裁决。
- **新增第四套 Preset `web-marketing`**（品牌官网 / 营销落地页）——此前"网站/官网/landing"不在任何 Preset 内。
- **行业枚举补快消 / 餐饮 / 食品**，并确立「用户显式品牌色 > 行业映射 > Preset」。
- **`description` 覆盖 L0–L5 全链路并补英文触发词**（`d5a4070`）——原描述只声明 L1，L4/L5 场景根本触发不到本技能。

---

## [1.0.0] — 2026-09-16

首个自包含开源版本（`16b3587`）。五层架构（L0 探测 → L1 Brief → L2 DS Spec → L3 构建 → L4 审查 → L5 导出）、三套 Style Preset、Bridge + Figma 插件写通道、示例与 JSON Schema。

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
- **C3·qa-export L5 出口闸门** —— 新增 `tools/qa-export.mjs`（**935 条断言**），把 1.2 之前**唯一的空规则**（L5 Export Gate）变成实际闸门。**九组检查**：QA1 **真 Schema 校验**（内置最小 draft-07 校验器，覆盖 `type` / `required` / `properties` / `items` / `enum` / `const` / `pattern` / `minimum` / `minItems` / `minLength` / `allOf` / `if-then-else` / `$ref`——上游只查了 `required` 与一个枚举，Schema 里其余 40 余条约束从来没人执行）· QA2 导出物存在 · QA3 `nodeId` 可回读（live-build 交叉引用 `exports ⊆ rootNodeIds`）· QA4 组件映射完整 · **QA5 `value` 快照必须与 DS Spec 原值逐字相等 + `source` 必须继承自 Spec 叶子 + `cssVariable` 命名规则 + 点路径回溯** · QA6 无孤儿映射 + Export Gate 自洽（`criticScore<8` 只允许 design-phase、`audit.criticScore == criticReport.average`）· QA7 冻结禁区（`figma-plugin/`、`bridge/`）零修改，**核不了必须说核不了** · **QA8 身份一致**（`project` == `source.brief.product.name` == `source.dsSpec.brand.name`；随包副本必须与追溯源同项目）· **QA9 可追溯性**（`preset:<id>.<路径>` 必须能在 `assets/style-library/` 的对应预设里真解析出来，`derived:` 必须给出 `@<源 token>` 指向）。判定分**硬 / 软两档**，`--strict` 把 WARN 升为失败（仓库自带样例走这一档）。配套 `tools/qa-export-mutation.mjs`（**56 条断言**：注入 30+ 类已知缺陷 + Schema 条件分支正反两例 + 基线零告警 + 冻结态「核不了必须说核不了」+ 无 `.git` 路径 + `--freeze` 覆盖）。另把 `references/export-mapping.md` §5 里**此前无任何文档定义**的 `value` 快照约定（字阶写 `size/lineHeight/weight`）与「`source` 继承 + 可解析」写成明文规则。
- **C3·qa-install 安装契约校验（C3 收口，四个脚本至此齐备）** —— 新增 `tools/qa-install.mjs`（**96 条断言**），校验「新用户照文档装完能不能真的用起来」，即 README / SETUP / USER_GUIDE / `references/runtime-capability.md` / 探针五方是否自洽。移植自上游的安装 QA 脚本（stage10-7-install-qa.py，109 行 / 56 断言），但把「grep 关键 token」换成**真跑探针、拿它自己的输出当事实源**——理由是上游那种写法只能证明「这串字在文件里出现过」：文档写 `未检测到 Figma 连接能力，仅可生成设计资产`，探针实际吐的是带尾注的更长串，两者都「含有关键 token」，检查全绿而**用户拿到的提示与文档不符**（本轮即抓到这一条，见下）。**九组检查**：QA1 安装入口交付物齐备 · QA2 探针静态约束（只读 / 零新协议 / **零外部依赖** / 公开端点不带 token）· **QA3 三模式端到端**（用真 bridge 取一份真实 `/health` 当模板，起 mock 插件翻 `plugin.connected` 得 FULL_MODE，再用假 `HOME` 造出 READ_ONLY 与 OFFLINE，**逐态对照 §3 Capability Matrix**——上游只在「本机恰好是什么模式」下跑过一次）· **QA4 只读承诺**（`--no-write` 不得落盘、不带则须落在文档声称的默认路径）· **QA5 cwd 无关性**（从别的目录跑，仍读得到自身 `VERSION`、仍写技能目录、不在 cwd 误建 `.vibe/`）· **QA6 四方口径一致**（模式枚举锁死：包内文档不得出现第四种 `*_MODE`；以及**用户可见提示语逐字复算**——凡以引号给出的提示，必须与探针实跑输出一字不差，形状前缀由真值派生而非写死；另要求「FULL_MODE 下 `figmaRead` 同为 true」这条**反直觉规则**在五份说明它的文档里都写着）· **QA7 安装合约事实**（端口**四处一致** + 运行时再从 `/health` 回声核对一次 · 插件侧必须是 `localhost` 拼写（Figma 校验器拒绝 `127.0.0.1`）· bridge 必须**同时绑 `::1`**（否则 `localhost` 解析到 `::1` 时插件连不上）· token 文件路径且**跨重启保持**（真起两次 bridge 对比）· `manifest.main`/`ui` 指向的文件存在、插件名与 SETUP 让用户选的一致 · `.gitignore` 必须忽略 `.vibe/`（否则 token 会被提交））· QA8 SKILL.md 注册与降级铁律 · QA9 落盘产物形状（软）。行为检查跑不起来时记「**装置缺口**」单列，不算产品缺陷（与 `precheck` 同一套三档口径），`--no-behavior` 可整体跳过行为段。配套 `tools/qa-install-mutation.mjs`（**78 条断言**：搭自包含「假安装包」夹具——真探针 + 真 bridge + 真清单 + 真文档，注入 30 类缺陷 + 基线零告警 + 一次报全部 + 降级路径 + 软档命中非零）。

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

- **`export-manifest.json` 里一句「描述说允许、语义上不允许」的谎（C3·qa-export 上线即抓到，并用 ajv 独立复核）** —— 该 Schema 把 `exports.png.minItems: 1` 写在**基座**，再在 `allOf[0].then` 里给 design-phase `minItems: 0`。但 JSON Schema 的 `allOf` 是**合取**，`then` 撤不掉基座的约束——净效果仍是 `minItems: 1`。于是 `description` 写着「design-phase 允许 exports.png 为空」，**语义上根本不允许**：随包的 `example-highway-export.json`（design-phase + 空 png）一直是 invalid，只是从来没人真校验过。修法：把 minItems 上限挪进 `else`，并给 `if` 补 `required: ["_meta"]`（否则缺 `_meta` 的清单会被 `properties` 的「只校验存在的键」漏洞**静默当成 design-phase** 放过——修完前者之后这个洞会变成 fail-open，必须一起堵）。另把 `tokens.color` / `tokens.typography` 的 `$ref` + `minItems` 兄弟键改成 `allOf` 写法（draft-07 规定兄弟键被忽略、ajv 等实现却生效，不该依赖这个歧义），并给三处 `properties` 补 `type`。同时修正两处**过度声称**的字段描述：`figmaJson.path` 原文写「design-phase 为 null」，但真实构建也可能只导了 PNG/SVG；`criticReport` 原文暗示路径必填，而其类型本就允许 null。已记入 `references/lessons.md` #41。
- **出口清单里 32 处「抄来的值」与其声明的 DS Spec 对不上（C3·qa-export 上线即抓到，属 C1 那一类病）** —— `export-manifest.json` 的 `tokens[].value` 是**发给前端的最终值**、`project` 是产品名，本该从 DS Spec / Brief 抄来，却从没人核对过：`example-health` 的品牌色写 `#5A5CF0`（Spec 是 `#0FB5AE`）、`brand.hover/active` 同理、`status.success` 写 `#10B981`（Spec 是 `#00B578`）、圆角写 8/12/16（Spec 是 6/8/10）、字阶 value 写 `15/21/400`（Spec 是 `14/20/400`）、`project` 多一个「 App」后缀（Schema 明文要求与 `Brief.product.name` 一致）；`example-highway` 的警告色写 `#F5C542`（Spec 是 `#FFB547`）、字阶 value 直接写成**自由文本**「14（TY-3 大屏提升档）」——这是机器读的字段，说明文字不该混进去。已写脚本**从 Spec 取值**逐一回填（32 处），避免手抄复发。
- **17 条 `source` 是「假溯源」（前缀合法但路径不存在）** —— token 映射的 `source` 写 `preset:enterprise-dashboard.visualSystem.typeScale`，五类前缀合法、看着很像，但四套 Style Preset 里**都没有 `typeScale` 这个键**（真名是 `typography`），三份清单 15 条字阶映射全中。另 `example-health` 把 radius 的来源写成 `preset:...radius`，而 Spec 明说它来自 `brief:visualSystem.radius` 的显式覆盖（Brief 覆盖 vs 预设缺省是完全不同的溯源）；`example-saas` 的 `tokens.radius.md` 同样丢掉了 Spec 里的 `geometry.cardRadius`。**前缀校验只能证明「格式对」，证明不了「指的东西存在」。** 已按各清单自己声明的 Spec 逐条回填，并在 QA9 里立起「`preset:` 源必须真解析一次路径」的硬判据。已记入 `references/lessons.md` #42/#43。
- **`example-health` 这个名字下住着两个不同项目（C3·qa-export 期间发现的**上游继承问题**，未擅自改写）** —— 核心示例 `assets/examples/example-health.json` / `.dsspec.json`（以及 `example-health/critic-report.json`）是 **「AI 型衣 / 美业」**：品牌紫 `#5A5CF0`、字阶 24/17/15/13/15、圆角 8/12/16、行业映射命中美业；而导出包的随包副本 `assets/examples/export/files/health-design-brief.json` / `health-design-system-spec.json` 是 **「AI 智能健康管理 / 医疗」**：青绿 `#0FB5AE`、字阶 26/16/14/13/16、圆角 6/8/10。两边各自内部自洽，所以单份校验全绿——只有把它们放在一起比才暴露。佐证：`example-health/critic-report.json` 的 `_meta.inputs` 自己写着依据是「AI **医疗** App 真实 Critic Loop 记录（同型问题）」，即核心示例是按照真实医疗项目的记录**重建**成美业的。**本轮只做两件事**：① 把文档里说错的地方改对（`SKILL.md` L4 段原写 `health = 消费健康 App`、`README.md` 原写示例是「医疗 App」）；② 在 `SKILL.md` 的 few-shot 与 `README` 里显式标注同名不同物，并记入 `references/lessons.md` #44。**重命名或对齐哪一边属于数据创作决策，留给 D2 之后定，不各按各的改——那只是把分裂固化。**
- **`SKILL.md` L4 段把 `health` 示例描述成「消费健康 App」（C3·qa-export 期间发现）** —— 该行指向 `assets/examples/example-health/critic-report.json`，而那份报告的 `project` 是「AI 型衣」、其 issue 讲的是 `BookingFlow 预约按钮` / `StyleGalleryCard 热度数字`（美业），与「消费健康」不符。已改为「美业 AI 试发 App『AI 型衣』」，并注明与 L5 随包副本不同源。
- **canonical 文档把 OFFLINE 提示截短了（C3·qa-install 上线即抓到）** —— `references/runtime-capability.md` §3 的 Capability Matrix 把 OFFLINE 模式的「用户可见提示」写成 `未检测到 Figma 连接能力，仅可生成设计 asset`，而探针实际输出的是 `未检测到 Figma 连接能力，仅可生成设计资产（Brief / DS Spec / Build Plan）`——文档比真实提示少了一个尾注，用户照着文档核对会以为探针有问题。**这类缺陷用「关键词是否出现」查不出来**（两串都含关键词，上游脚本正是这么查的、所以一直是绿的），只有拿实跑输出逐字比才现形。已按实跑值改齐（`qa-install` 的 QA6 由此立起「引号住的提示语必须与实跑逐字一致」的判据）。
- **`SETUP.md` 把 token 文件说成「运行目录」（C3·qa-install 期间发现）** —— bridge 用 `path.resolve(__dirname, "..")` 取根目录、token 落在**仓库目录**的 `.vibe/token`，与 cwd 无关；而 `references/bridge-ops.md` 写的是 `<repo>/.vibe/token`。两份文档对同一个文件给了不同锚点，照 `SETUP.md` 从别处启动会得到错误预期。已改为「仓库目录（与你在哪个目录敲命令无关）」，并在 QA7 立起判据：凡提到 `.vibe/token` 的那一行必须把它绑定到仓库而非 cwd。
- **`qa-install` 自己的三处缺陷（写变异测试时全部被抓出，无一靠肉眼发现）** —— ① **缺文件时崩成堆栈**：第一版直接 `read("SETUP.md").match(...)`，SETUP.md 一被删就 ENOENT 崩掉——**它连它要抓的那个缺陷（缺文件）都报不出来**，用户只看到一段栈而真正的问题没被说出口。已改为所有读取容缺、缺文件本身交给 QA1 如实报出（并记入 `references/lessons.md` #45）。② **`includes(名字)` 被注释喂饱**：`includes("figma-developer-mcp")` 会被探针头部注释里的同一串字满足——把真正的判定分支删掉，检查照样绿；`includes("::1")` 同样被注释里的 `::1` 满足。已改为判**形状**（断言落在真实的 `haystack.includes("x")` / `const LOOPBACK_V6 = "::1"` + `.listen(PORT, LOOPBACK_V6)` 上），且 MCP 期望名单改为**从 canonical 文档派生**而非写死（记入 #46）。③ **降级开关「连坐」**：`--no-behavior` 本意只跳过要起进程的检查，但提示语复算的**真值**来自那次实跑，于是被一并跳过——**最值钱的检查在降级模式下静默消失**，而汇总里四组「装置缺口」看着还挺诚实。已把提示语真值改为轻量恒跑（只跑探针两次，不起 bridge/mock，记入 #47）。
- **一条「一直绿、却从来没测到东西」的用例（同上，由变异测试抓出）** —— QA3 的「bridge 可达但插件未连 → 读写皆 false」用例一直是绿的，但把探针的 `figmaWrite` 改成 `bridge.reachable` 之后**它还是绿的**。根因是装置把 `url` 返回成了**含 `/health` 的完整 URL**，探针自己去拼 `${BRIDGE_URL}/health` 得到 `/health/health` → 404 → 一路退化成「没有 bridge」，于是这条用例在「连不上」的假象里通过，**从来没真的走到那个分支**（真正去连真 bridge 的只有 QA3 的 `/health` 形状三条断言）。已改为返回 base URL；修完之后该变异立刻变红。**判据：变异之后仍然绿的用例，比变异之后变红的用例更值得看**（记入 `references/lessons.md` #48）。

### 待办

- D1 硬验收 · D2 两次实测校准（B1/B2 的预检效果应在 D2 里被真正用上并记数据；`example-health` 同名两物的重命名 / 对齐也在此决定）
- **待决策（需人拍板，不擅自改）**：`example-health` 同名两物（美业「AI 型衣」vs 医疗「AI 智能健康管理」）—— 是重命名核心示例、还是把随包副本对齐到核心示例、还是两边都保留但改名，属数据创作决策。定之前在文档层如实标注（见上方「修复」段与本文件条目）。
- `example-health` 的 `critic-report.json` 已按核心示例（美业）对齐；若后续决定以医疗为准，该报告与其 `_meta.inputs` 需一并重做。

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

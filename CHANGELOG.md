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
- **A5 实测不变量清单** —— 新增 `references/lessons.md`：上游七个阶段沉淀的 **30 条**实测踩坑不变量（协议 / Plugin API / 数据流 / 测试 / Windows 环境 / 协作），按本仓库命名与实现适配，并逐条标注**已被工具守卫（⚙️）还是只能靠纪律（📏）**；另补本仓库 1.1–1.2 新得的 5 条（安装副本与开发仓库漂移、校验器判断顺序本身是缺陷来源、校验器必须配变异测试、人工勾选治不住文档脱节、打包排除项会悄悄删掉质量资产），共 **35 条**。`SKILL.md` 增加入口段，指明「动手前先读」。

### 修复

- **`design-system-spec.json` 的 `stylePresetId` 枚举缺 `web-marketing`** —— 1.1 新增的第四套 Preset 一直无法通过 DS Spec 校验。
- **派生色校验可被绕过**（移植上游脚本时发现的逻辑漏洞）—— 上游先判「值是否在 preset 色板内」、再判是否派生，导致**派生 token 的值只要填成任意一个色板色就能蒙混过关**（`hover` 错填 `#000000` 或 `#FFFFFF` 均不报警）。改为：带 `derived:` 前缀即强制走公式复算。
- **`check-refs.mjs` 的路径正则漏掉点目录**：首字符类不含 `.`，导致 `.vibe/runtime-capability.json` 这类**点目录开头**的路径整条连不上——既不报错也不进豁免，等于运行时豁免规则空转（真实仓库里「豁免 运行时=0」即是证据）。已由变异测试的「豁免计数非零」断言守住。
- **A4 上线即抓到一处真实问题**：`references/lessons.md` 初稿把**不存在**的 package.json 加了反引号。按本仓库文档惯例，反引号包住路径即声明「仓库内有此文件」，故改的是文档措辞（改为叙述 npm 的通用行为），不是放宽校验器。

### 待办

- B1 Build Plan 静态预检 · B2 `--live` 在线引用核对
- C1 对比度审计 · C2 L4 证据链两档化 · C3 其余三个脚本（`qa-critic` / `qa-export` / `qa-install`）· 并把 `SKILL.md` L4/L5 段「本 Skill 不随包附带校验脚本」的表述改为指向脚本
- D1 硬验收 · D2 两次实测校准

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

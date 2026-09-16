# design-system.md — L2 完整转换规则

> **层级**：L2 Design System Generation ｜ **输入**：L1 的 Design Brief JSON ｜ **唯一出口**：DS Spec JSON
> **正本 Schema**：`assets/templates/design-system-spec.json`
> **few-shot**：`assets/examples/example-{saas,health,highway}.dsspec.json`（与同名 Brief 一一对应）
> **回归测试**：`node tools/qa-l2.mjs`（四项检查，见 §13）
> **来源**：本文件是上游 `figma-vibe-bridge` stage10.4 设计的适配版——规则主体沿用其 281 行成熟设计，另接本仓库 1.1 新增的 `web-marketing` Preset 与字体降级链，并补上游自承缺失的 `web-site` 平台模板。

---

## 1. 定位与本层的性质

L2 是**规则引擎，不是创作引擎**。

```
L1 Design Brief ──唯一输入──▶ L2（本层） ──DS Spec 唯一输出──▶ L3 Figma Build
```

- L3 **禁止**直接消费 Brief 或任何自然语言需求。DS Spec 就是它们之间唯一的契约。
- L2 **不产生任何 Figma 节点**（那是 L3 的职责），不评分（L4 职责），不做导出（L5 职责）。

### ⚠️ 关于「文档形态」的诚实声明（红线下的次优解）

本层规则以**文档 + 人工执行**形态存在，**没有任何代码化的规则引擎**。这是刻意的取舍：

- 最优解是把 Brief→DS Spec 的推导写成一个生成器（同输入必得同输出，零方差）；
- 但那会引入 Node/Python 工程化封装，与「零额外依赖、不过度封装」的红线冲突；
- 因此取次优解：**规则显式化 + 校验自动化**。文档降低方差，`qa-l2.mjs` 拦截越界——**但不消除方差**。同一份 Brief 交给不同模型，仍可能产出不同的合法解。这个边界必须如实承认，不得宣称「确定性」已被实现。

---

## 2. 流水线（五段线性，禁止跳步）

```
Design Brief JSON（L1 出口物）
  → ① Token Generation      生成五类 token，全部带 source（§4–§8）
  → ② Component Decision    对 Brief.componentExpectation 逐条判定（§9）
  → ③ Layout Intelligence   按平台模板生成页面分区（§11）
  → ④ Build Plan            预估 L3 构建批次（≤30 ops/批，交接参考）
  → DS Spec JSON（唯一出口物）
```

**四段串行依赖**（顺序不可颠倒）：

| 依赖 | 说明 |
|---|---|
| Token → Component | 组件状态取值引用 status token |
| Component → Layout | 分区挂载组件（zone 说明必须点明挂哪个组件） |
| Layout → BuildPlan | 按分区估 op 数 |

中间产物 `componentPlan`（§9.3）与 `layoutPlan`（§11.3）**不单独交付**，最终合并进 DS Spec 的 `components` / `layout` 字段。

---

## 3. 三条不变式

| # | 不变式 | 含义 | 违反的样子 |
|---|---|---|---|
| 1 | **确定性** | 规则未覆盖处写入 `sourceMapping.assumptions`，**禁止静默自由发挥** | 冒出一个没有 source 的 token |
| 2 | **可溯源** | 每个 token 必须携带 `source` 字段（五种前缀，§4.3）；可反向审计到 Preset 或规则 | source 写成 `preset:xxx` 但值不在该 preset 里 |
| 3 | **单源** | L2 不产生 Figma 节点；**存量 DS 项目 `generate-core` 必须为 0** | 存量项目里新建了 `DS/` 前缀组件 |

---

## 4. Token 生成

### 4.1 五类 Token

| 类别 | 子组 | 来源 |
|---|---|---|
| **Color** | Brand（primary / hover / active）· Background（page）· Surface（card）· Text（primary / regular / secondary / placeholder）· Border（default / divider）· Status（success / warning / danger / info）· Chart（series1–5） | preset / brief / derived |
| **Typography** | Display · Heading · Body · Caption · Number/Data（等宽数字） | preset / brief + TY 规则 |
| **Spacing** | base · scale · cardPadding · cellPadding · pagePadding | preset + SP 规则 |
| **Radius** | sm · md · lg | preset / brief |
| **Shadow** | card · overlay · glow | **仅 preset，禁止派生** |

### 4.2 禁令（确定性红线）

色值只能出自三个来源：

1. **Style Preset 的 `visualSystem`**（`primaryColor` / `background` / `surface` / `textColors` / `stroke` / `chartColors`）
2. **Brief 显式覆盖**（必须同步记录进 `sourceMapping.briefOverrides`）
3. **白名单派生规则**（仅 §5 的四条）

**除白名单派生外，不允许任何混色、透明度变体、新增灰阶。** Preset 只有一个 shadow 时就只有一个 shadow——需要更多 elevation 层级走「修订 Style Preset」流程，**不得运行时派生**。

> 特例：`placeholder` 无第四灰阶时复用 `textColors[2]`（rule:TY-4），不得造新灰。

### 4.3 source 字段规范（五种前缀）

```
preset:<id>.<json路径>              例：preset:enterprise-dashboard.visualSystem.primaryColor
brief:<字段>                        例：brief:visualSystem.radius(8/12/16)
rule:<rule-id>                      例：rule:ST-1@preset.chartColors(绿系)
derived:<rule-id>@<父token路径>      例：derived:RD-1@tokens.color.brand.primary
existing-ds:<组件名>                例：existing-ds:DS/Form/Button
```

`sourceMapping` 聚合五项：`presetId` + `rulesUsed`（本次启用的规则 id 全集）+ `briefOverrides` + `existingDsRefs` + `assumptions`。

> **`avoidOverrides` 的消费**（接 L1 §⑧）：Brief 若带 `style.avoidOverrides`（用户显式点名而被移出禁用清单的手法），L2 **不得**把被覆盖项写回禁用清单，也不得据此否决它。这是 L2/L4 共用同一份裁决（见 `design-intelligence.md` §⑧）。

---

## 5. 派生规则白名单（仅此四条）

**公式实现**：逐通道线性混合后四舍五入（half-up）取整。`qa-l2.mjs` 会按此公式逐条复算并精确匹配。

| 规则 | 公式 | 用途 |
|---|---|---|
| **RD-1** | `hover = primary×0.88 + 表面色×0.12`；浅色主题表面色 = `#FFFFFF`，深色主题 = `background` | `color.brand.hover` |
| **RD-2** | `active = primary×0.92 + #000000×0.08` | `color.brand.active` |
| **RD-3** | `divider = default×0.5 + 混合基×0.5`；浅色主题混合基 = `#FFFFFF`，深色主题 = `surface` | `color.border.divider` |
| **ST-1** | status 四色 = 从 `preset.chartColors` **按色相分类映射**（绿系→success、黄/橙系→warning、红系→danger、蓝/青系→info），**不改值不混色** | `color.status.*` |

**深色主题（gov-digital-screen）的 RD-1 / RD-3 使用其深色变体**——这是 §5 公式里「深色主题」分支的实际用途，few-shot `example-highway` 已示范。

其余全部 token **一律直取**，不派生。

---

## 6. Typography 规则

| 规则 | 内容 |
|---|---|
| **TY-1** | Number/Data token 一律等宽数字（`tabular-nums`）；字体取 preset，字阶取 body 档或 preset 的数字强调档 |
| **TY-2** | Brief/preset 只给字号未给行高时：`lineHeight = size + (size ≥ 20 ? 8 : 6)` |
| **TY-3** | gov preset「禁 <14px」**优先于**常规字阶下限——caption 从 12 提升至 14（few-shot highway 已示范） |
| **TY-4** | 无第四灰阶时 placeholder 复用 `textColors[2]` |

### 6.1 字体族的降级链（Windows 可用性硬约束）

Preset 的 `typography` 写的是**降级链**，不是单一族名：

```
PingFang SC → Microsoft YaHei → Inter 兜底
```

理由：Windows 的 Figma **没有 PingFang SC / SF Pro**，直接 `loadFontAsync` 会抛错。因此：

- L2 输出的 `fontFamily` 字段**必须带降级链**（`"PingFang SC + Inter"` 这类写法见 few-shot）；
- 真正生效的字体由 **L3 按序探测后回填**（见 `bridge-ops.md` §6）；
- 若 Brief 是英文/国际化取向，可直接用 `Inter`（Figma 云字体恒可用）。

---

## 7. Spacing / Radius / Shadow 规则

| 规则 | 内容 |
|---|---|
| **SP-2** | 密表格（dense）`cellPadding` 缺省 **12** |
| **SP-3** | mobile-app 的 `pagePadding` / `cardPadding` 缺省 **16** |
| **Radius** | 取 preset 档位；Brief 显式覆盖时记录进 `briefOverrides`（health 示例覆盖为 8/12/16） |
| **Shadow** | **逐字取 preset，禁止派生**；gov 的 `glow` 必须声明 `usage`（仅关键指标与地图热区） |

---

## 8. 与上下游的接口契约

- **对 L1（输入校验）**：Brief 必须能通过 `assets/templates/design-brief.json` 校验；`_assumptions` 非空时**逐条继承**进 `sourceMapping.assumptions`。
- **对 L3（输出消费）**：L3 只读 DS Spec——

  | DS Spec 字段 | L3 的用法 |
  |---|---|
  | `components[].figmaNaming` | DS 命名规范 `DS/<Category>/<Name>` |
  | `tokens` | QA4 Token 审计的 unknownColors 白名单 |
  | `components[].decision` | 构建策略：`reuse-core` = create-instance 前先 get-node 校验存在；`extend` = 新增 variant；`create-local` = 页内本地 Frame（**禁止 `DS/` 前缀**，用 `Local/<Page>/<Name>`）；`reject` = 跳过 |
  | `buildPlan.estOps` | 每批 ≤30（构建批规模红线，Schema `maximum` 强制） |
  | `preset.geometry` | geometry 红线经 token 传递，L3 **不另行引入数值** |

- **geometry 红线**（由 preset 经 token 传递，L3 不得自创数值）：enterprise 的 Button/Input/Select 高 30、Table Header 40 / Row 44、Card 圆角 4、画布 1440×900。

---

## 9. Component Decision Matrix

### 9.1 判定流程（对 `Brief.componentExpectation` 逐条，按序短路）

```
① reject？      纯视觉装饰 / 与既有组件能力重叠的低频变体 → reject
② reuse-core？  目标文件已存在同职责 DS 组件，且 geometry 与 token 满足需求 → reuse-core
③ extend？      与既有（或本次已生成的）组件 ≥80% 结构一致，仅差 variant / 语义取值
                → extend（新增 variant，不新建组件）
④ create-local？页面特殊结构 / 跨页复用 <3 次 → create-local（不污染 DS）
⑤ generate-core 绿地项目（无既有 DS）且属于：
                a. preset.coreComponents 命中项（平台必需组件按 CD-2b 适配）
                b. 跨页复用 ≥3 次的通用件（CD-1 阈值）
                c. 被多个 extend 依赖的基础原语（CD-3，须显式标注）
```

**短路顺序不可颠倒**：先否后建。反复用同一组件时，`②` 命中就停在 `②`，不要再往下判。

### 9.2 判定规则明细

| 规则 | 内容 |
|---|---|
| **CD-1** | `generate-core` 复用阈值：跨页复用 **≥3 次**；不足则 `create-local` |
| **CD-2** | `extend` 相似度阈值：**≥80% 结构一致**、仅 variant / 语义差异；`extend` 必须写明 `variants` 清单 |
| **CD-2b** | **平台必需导航组件**（如 mobile 的 TabBar、web-site 的 NavBar）不在 preset `coreComponents` 时，绿地项目按 `generate-core` 生成；平台适配例外须已在 Brief `_assumptions` 声明 |
| **CD-3** | 基础原语补充：Brief 未显式列出、但被 ≥2 个 extend 依赖的原语（如 Card），补入 plan 并标注来源 |
| **CD-4** | `reject` 条件：① 纯视觉装饰无复用价值 ② P2 且与既有组件能力重叠（列配置级差异用实例覆写覆盖） |

### 9.3 输出：componentPlan（合并进 `DS Spec.components`）

每条结构：

```jsonc
{ "name", "briefRefs": [], "category", "priority", "decision",
  "figmaNaming"?, "variants"?, "basis", "states": [] }
```

**三条硬约束**（`qa-l2.mjs` 会查）：

1. **`briefRefs` 并集必须恰好等于 `Brief.componentExpectation`**——缺一个不行，多一个也不行。（合并场景如 State 三合一：一条覆盖 EmptyState/ErrorState/LoadingState）
2. **`basis` 必须引用具体条件**（复用次数 / 相似度 / geometry 红线 / priority），**禁止「感觉合适」**。
3. **覆盖约束**：P0 组件 **100% 覆盖**；`reject` **仅允许出现在 P1/P2**。

---

## 10. Component State Matrix

### 10.1 必选四件套（Brief 中出现即必须完整给出）

| 组件 | 必选状态 |
|---|---|
| **Button** | `primary` · `secondary` · `disabled` · `loading` |
| **Input** | `default` · `focus` · `error` · `disabled` |
| **Table** | `header` · `row` · `empty` · `loading` |
| **Card** | `default` · `hover` |

### 10.2 其余组件按类型基线（可裁剪，禁止杜撰）

| 类型 | 状态基线 |
|---|---|
| `navigation` | `default` · `active`（Pagination 增 `disabled`） |
| `feedback` | 语义态（success/warning/danger/info）或 `default` |
| `chart` | `default` · `empty`（**图表必须有空数据态**） |
| `data-display` | `default`（有交互再加 `hover` / `selected` / `offline` 等行为态） |

状态取值所需的颜色**一律引用 status token，禁止为状态造色**。四件套状态缺失 = QA FAIL。

---

## 11. Layout Intelligence

### 11.1 四平台分区模板

**Dashboard（`web-admin`，sidebar-content）**

```
┌─ Sidebar(240xFILL) ┬─ TopBar(FILLx56) ────────────────────┐
│                    ├─ BreadcrumbBar(FILLx48)              │
│                    ├─ 内容区（按页面类型）：                │
│                    │   Dashboard: KPI Grid(4列) → Chart Area(2:1) → Table │
│                    │   管理页:   FilterRow(30px) → Table → Pagination     │
│                    │   详情页:   InfoCard(+Tabs)                          │
│                    │   设置页:   FormCards 纵列                            │
└────────────────────┴──────────────────────────────────────┘
读取顺序即构建顺序（z 字形），KPI→图→表与「总览→趋势→明细」的阅读动线一致。
```

**Marketing Site（`web-site`，top-nav-content）** ← *本仓库 1.1 补，上游缺失*

```
NavBar(FILLx64, 吸顶) → HeroSection(FILLx≥560, 全幅)
  → LogoWall(1200 居中) → FeatureBlock ×N(1200 内容宽) → TestimonialBlock
  → PricingTeaser → FAQList → CTASection(FILL 色带) → Footer(FILL)
自上而下读取顺序即构建顺序。营销叙事动线：吸引 → 信任 → 价值 → 决策 → 答疑 → 行动。
```

**Mobile App（`mobile-app`，tab-flow）**

```
StatusBar(44) → NavBar(44) → Hero(全幅出血) → Content Card(2列流) → TabBar(56+safeArea34)
```

**Government Screen（`big-screen`，full-bleed-screen）**

```
┌───────────────── TitleBar(1920x86, 占高 8%) ─────────────────┐
├─ Left Panel(25%) ┬──── Center GIS(960, ≥50% 图表红线) ┬─ Right Panel(25%) ─┤
└──────────────────┴───────────────────────────────────┴────────────────────┘
KPI Tile → GIS Center → Monitoring Panels；数据即装饰，动效每屏 ≤2 处。
```

### 11.2 布局规则

| 规则 | 内容 |
|---|---|
| **LD-2** | web-admin `TopBar` 高度缺省 **56**（存量项目以 readback 为准，冲突时回写 Spec） |
| **LD-3** | web-admin `Sidebar` 宽度缺省 **240**（同上） |
| **LD-5** | iOS 移动端：状态栏 44 / NavBar 44 / TabBar 56 + safeArea 34 |
| **LD-6** | web-site `NavBar` 高度 **64**（桌面）/ **56**（移动档） |
| **LD-7** | web-site 内容容器最大宽度 **1200**；水平 padding 桌面 **≥64** / 移动 **≥24** |
| **LD-8** | web-site 区块垂直间距 **96–160**（对应 `contentDensity: sparse`）；Hero 可用全幅色块打底 |
| **LD-9** | web-site 在 **<768** 档：所有多列区块降为单列，Hero 展示字阶降档 |
| **GEO-1** | 分区尺寸取整到 px（如 1080×8% ≈ 86） |

**`zone.size` 只允许三种写法**：`WxH`（固定）/ `WxFILL`（锁定+伸缩）/ `FILL`。

> **数值来源红线**：layoutPlan **不产生任何无来源数值**——每个尺寸必须出自 token、`preset.geometry` 或上述 LD 规则。涉及规则缺省值时显式声明「以 readback 为准」。

### 11.3 输出：layoutPlan（合并进 `DS Spec.layout`）

```jsonc
{ "pattern", "frameBaseline",
  "pages": [ { "name",  // 与 Brief.informationArchitecture.pages[].name 一一对应
               "zones": [ { "name", "role", "size", "order"?, "notes"? } ] } ] }
```

`zone.notes` **必须写明尺寸/组件出处**（如 `rule:LD-5(iOS 状态栏 44)`、`StyleGalleryCard 实例`）。

---

## 12. DS Spec 字段映射

正本：`assets/templates/design-system-spec.json`（JSON Schema draft-07）。

**八个必填字段**：

| 字段 | 来源 | 内容 |
|---|---|---|
| `brand` | Brief.product + designDirection | name / industry / stylePresetId / contentDensity |
| `platform` | Brief.product.platform | `web-admin` / `web-site` / `mobile-app` / `big-screen` |
| `tokens` | §4–§8 | color(7 组) / typography(5) / spacing / radius / shadow，**全量带 source** |
| `components` | §9 componentPlan | 判定结果 + briefRefs + states |
| `layout` | §11 layoutPlan | pattern / frameBaseline / pages[].zones |
| `responsive` | 平台规则 | baseline / breakpoints / rules |
| `accessibility` | AC 规则 | contrast 逐条结论 / minFontSize / touchTarget / focusRing |
| `sourceMapping` | §4.3 | presetId / rulesUsed / briefOverrides / existingDsRefs / assumptions |

**可选字段 `buildPlan`**：L2 预估的构建批次视图（`estOps` 上限 30 由 Schema `maximum` 强制）。**真正的批次规模以 L3 运行期 readback 为准**，本字段仅作交接参考。

### 12.1 四套 Style Preset 均可作为 `stylePresetId`

`premium-saas` / `enterprise-dashboard` / `gov-digital-screen` / **`web-marketing`**。

> `web-marketing` 与 `web-site` 平台配套（1.1 新增）。它与 `premium-saas` 的分界：**一个服务营销叙事页（Hero/区块节奏/转化路径），一个服务订阅制产品界面。**

---

## 13. QA 判据（`node tools/qa-l2.mjs`）

四项全绿才算 L2 完成。脚本离线运行、零依赖，逐份 dsspec 校验：

| # | 检查 | 判据 |
|---|---|---|
| **QA1** | JSON 可解析 | Schema + 全部 `*.dsspec.json` 可解析；Schema `required` 顶层字段在每份 spec 齐备 |
| **QA2** | Token 无未知颜色 | 逐份收集 `tokens.color` 全部 hex：**非派生值**必须 ∈ 对应 preset 的 `visualSystem` 色板（含 chartColors 与 `#FFFFFF`/`#000000` 混合基）；**带 `derived:` 前缀者必须先走 §5 公式逐通道复算并精确匹配**——复算优先于色板命中，否则「把派生值填成任意一个色板色」就能蒙混过关（如 hover 错填成 `#000000`/`#FFFFFF`）；`derived:` 前缀格式不符 `derived:<rule>@<父token路径>` 亦算 FAIL |
| **QA3** | Component 覆盖与数量 | `briefRefs` 并集 = Brief 全量（缺/多都算 FAIL）；P0 覆盖率 100%；**绿地 `generate-core` ≤12 / 存量 = 0**；`reject` 仅限 P1/P2 |
| **QA4** | DS 单源原则 | `create-local` 的 `figmaNaming` 一律 `Local/...`（`DS/` 前缀 = 0）；Button/Input/Table/Card 四件套状态矩阵完整；`buildPlan.estOps` 全部 ≤30；chart 色板与 preset **逐字一致** |

**运行**：`node tools/qa-l2.mjs`（任意 cwd 可跑，路径由脚本自身定位）。

---

## 14. L2 出口自检（Stage Gate）

L2 交付前逐条核对，**未跑的不得声称已跑**：

1. DS Spec 通过 `assets/templates/design-system-spec.json`（QA1）
2. 每个 token 都有 `source`，且值可回溯到 Preset / Brief 覆盖 / 白名单派生（QA2）
3. `briefRefs` 并集 = Brief 全量，P0 无缺（QA3）
4. 存量项目 `generate-core` = 0；`create-local` 无 `DS/` 前缀（QA4）
5. 四件套状态矩阵完整；`buildPlan.estOps` ≤30（QA4）
6. 规则未覆盖处已写进 `sourceMapping.assumptions`——**规则命中处不得写入**（会污染审计）

> 出口校验**由 `qa-l2.mjs` 实际执行**，不是「照着清单人工感觉核对」。若环境无法运行脚本，须在交付物中明确标注「未自动校验」，不得暗示已校验。

---

## 15. 与 L1 / L4 的接缝

| 接缝 | 规则 |
|---|---|
| L1 → L2 | Brief 的 `_assumptions` **逐条继承**；`style.avoidOverrides` 是 L2/L4 的共同输入（§4.3） |
| L2 → L4 | L4 若判定问题出在 token / 组件，回写对象是 **DS Spec 与 Brief**（经 `critic-mapping.md` 路由），L2 不做局部私自修补 |
| L2 → L3 | 见 §8 接口表；L3 是 DS Spec 的唯一消费者 |

**禁止跨层私改**（CL-6）：L4 发现 token 问题不得直接改 Figma 节点，必须回到 L2 层修 DS Spec 再重建。

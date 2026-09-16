# Export Mapping — Figma → Frontend 组件与 Token 映射规则

L5 Export 的 mapping 部分（Export Manifest §mapping/§tokens）判定依据。目标：设计资产进入前端实现时**映射确定性**——每个 Figma 节点都知道自己变成什么，每个 CSS Variable 都能回溯到 token。

## 1. Component Mapping Matrix（A/B/C 三类）

| 类 | 定义 | 典型组件 | 前端形态 |
|---|---|---|---|
| **A-direct** | Figma 组件与前端组件一一对应，props 由 variant/state 直接翻译 | Button、Input、Card、Badge、Avatar、Checkbox | `<DsButton variant="primary">` |
| **B-composite** | 前端一个组件 = 多个 Figma 节点/实例的组合，或反之 | Table、PageShell、Dashboard 区块、Navbar（含 StatusBar+NavBar） | `<DsTable :columns rows>` |
| **C-manual** | 结构自由/插画性质，无法稳定参数化 | 复杂插画、地图面板、自由布局拼贴、装饰性 aurora | 无自动组件；人工实现 + 设计标注 |

判定顺序：先试 A（名称对应 + variant 可枚举）→ 再试 B（组合规则可写清）→ 都不行才是 C。**C 类必须给 manualNote**（为何不可自动 + 人工实现入口），禁止静默丢弃。

## 2. A 类映射示例（直接映射）

```
Figma: DS/Form/Button/Primary|Secondary|Disabled|Loading   （4 个状态组件）
   ↓ variant 归并（state 组件 → 单组件多 variant）
Vue:
   <DsButton variant="primary" />      // primary | secondary | disabled | loading
   props: variant ← 状态组件后缀；disabled 属性 ← Disabled 态；loading ← Loading 态
```

```
Figma: DS/Form/Input/Default|Focus|Error|Disabled
   ↓
Vue:
   <DsInput size="md" status="error" />
   props: status ← 状态组件后缀（default|error）；focus 是交互态不进 props，进 CSS :focus
```

```
Figma: DS/DataDisplay/StatCard（实例 + 文本覆写）
   ↓
Vue:
   <DsStatCard icon="heart" value="72 bpm" label="心率" />
   props: icon/value/label ← 实例内三个覆写槽（icon/value/label，来自 构建期 readback 命名）
```

**A 类判定条件**（全部满足才算 A）：
1. Figma 侧是 native Component（或 create-local 结构稳定复用 ≥3 次）；
2. variant/state 可完整枚举且与 L2 状态矩阵一致；
3. 实例差异全部可通过属性/插槽表达（无结构性差异）。

## 3. B 类映射示例（组合映射）

```
Figma: Table = Header(40) + Row×N(44) + Pagination 实例
   ↓
Vue:
   <DsTable :columns :rows :pagination />
   组合规则：Header 由 columns 配置生成；Row 由 rows.map 渲染（行内操作列走 slot）
```

```
Figma: PageShell = TopBar + TagsBar + Sidebar + Content 区
   ↓
Vue:
   <DsPageShell>  <template #sidebar>…  <router-view />
   组合规则：布局骨架固化，内容区全部 slot 化
```

**B 类判定条件**：组合结构稳定（层级/顺序固定），子项可枚举，组合规则能写成一段话。B 类 entry 的 props 必须写明组合来源（如 `rows <- TableRow×N 实例`）。

## 4. C 类示例

```
Figma: Local/Home/AuroraBackground（三色斑+同心 ring 装饰）
   ↓
frontendComponent: null
manualNote: "装饰层无参数化价值；前端用 CSS 渐变/SVG 实现入口 designer-handoff#12，视觉验收对齐 PNG"
```

## 5. Token → CSS Variable 规则

命名：`--ds-` + `tokens.` 之后的路径转 kebab（`.`→`-`，camelCase 边界→`-`）：

| DS Token | CSS Variable |
|---|---|
| `tokens.color.brand.primary` | `--ds-color-brand-primary` |
| `tokens.typography.body` | `--ds-typography-body` |
| `tokens.spacing.cardPadding` | `--ds-spacing-card-padding` |
| `tokens.radius.md` | `--ds-radius-md` |
| `tokens.shadow.card` | `--ds-shadow-card` |

约束：
1. **不重命名、不换算**：value 原样导出（px 不转 rem，换算属实现层职责并记录在 layoutRules）；
2. **source 必须随行**：token 映射条目继承 DS Spec 的 source 前缀（preset:/brief:/rule:/derived:/existing-ds:），derived 值导出的是**重算后的最终值**；
3. QA5 会沿 `dsToken` 点路径回溯 DS Spec 原文验证存在性，并校验 cssVariable 命名规则。

## 6. Layout → Implementation Rules（mapping.layoutRules）

导出时必须随包交付的转换约定，典型条目：
- `auto-layout vertical + counterAxisAlignItems MIN → flex flex-col items-start`
- `primaryAxisSizingMode FIXED + width 402 → w-[402px]`（数值必须来自 token/frameBaseline）
- `set-layout-sizing FILL → flex-1 / w-full`
- `实例文本覆写槽 → props/slot`（构建期 readback 的 icon/value/label 槽命名直接映射）
- 文本自动行高陷阱：Figma FIXED 行高 → `leading-[Npx]`，禁止依赖默认行高

## 7. 完整性判定（QA6 依据）

- 双向覆盖：DS Spec 中所有 `decision != reject` 的组件名 ⊆ mapping.dsName；mapping 中每个 dsName 必须能在 DS Spec 找到（否则为孤儿映射）；
- 非 C 类条目 frontendComponent 非空；C 类必有 manualNote；
- 同名多决策（generate-core + extend）按名去重后映射一次，variants 合并并在 notes 注明。

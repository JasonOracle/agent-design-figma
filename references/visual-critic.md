# Visual Critic — L4 视觉评审层（五维评分模型 + Critic Loop）

## 定位

五层架构中的第四层：**对 L3 生成结果做结构化审查，产出可执行的修正建议并路由回对应层**。
输入 = Figma 导出物（PNG 截图 + get-node 结构化读回）+ L2 DS Spec；输出 = Critic Report JSON（唯一出口物）。

```
Figma Export PNG / 结构化 READBACK
  → ① Layout 审查（几何 readback，逐节点）
  → ② Color 审查（token 扫描）
  → ③ Consistency 审查（组件/档位一致性）
  → ④ Commercial 审查（商业感锚点比对）
  → ⑤ Usability 审查（层级/触控/路径）
  → Critic Report JSON → critic-mapping.md 路由 → 回写 L1/L2/L3 → 重新生成受影响节点
```

核心原则：**每条 issue 必须携带 evidence**——能给出节点 id、实测值与规则出处的才算 issue；"感觉不对"不入册。评分可以带主观（Commercial 维），issue 不允许。

---

## 1. 五维评分模型

每维 0–10 分（一位小数），**每个扣分点必须引用证据节点**（Figma node id / get-node 实测值）。

### 1.1 Layout Score（布局）

| 检查项 | 判定依据 | 权重 |
|---|---|---|
| 页面比例 | 页框尺寸 = frameBaseline（±1px 容差），ZONE 高度与 L2 layout.pages[].zones 一致 | 30% |
| 网格一致性 | 同级兄弟间距全部落在 token spacing.scale 档位上（实测 gap ∈ scale） | 25% |
| 对齐误差 | 同组元素左/右/中轴对齐偏差 ≤1px（readback x 坐标逐个比对） | 20% |
| 留白比例 | 页面 padding ∈ [pagePadding, pagePadding×1.5]；卡片间距 ≥ 12px（balanced） | 15% |
| 信息密度 | 一屏内容量与 contentDensity 匹配：sparse ≤4 组 / balanced 5–8 组 / dense ≥9 组 | 10% |

证据来源：get-node（detail:true）读回的 x/y/width/height/autoLayout，**禁止目测**。
典型扣分：页框被 HUG 收缩（≠874）、同级 gap 出现 13/17px 非档位值、Zone 缺失。

### 1.2 Color Score（色彩）

| 检查项 | 判定依据 | 权重 |
|---|---|---|
| Token 使用率 | 全页扫描 fills/strokes，unknownColors = 0（白名单 = L2 tokens 全量 + #FFFFFF/#000000） | 35% |
| 主色比例 | primary 面积占比 5%–15%（<5% 品牌感弱，>15% 视觉疲劳）；深色大屏放宽至 3%–20% | 20% |
| 对比度 | text.primary/regular on surface ≥ 4.5:1（WCAG AA）；caption ≥ 3:1 | 20% |
| 状态色规范 | success/warning/danger/info 只出现在语义场景，不得挪作装饰 | 15% |
| unknownColors | 每出现 1 处非白名单色：本项计 0 且必须出 issue（severity=high） | 一票扣 |

工具化判定：与 Token 审计规则同源（十六进制扫描 + 白名单比对），确保可复现。

### 1.3 Consistency Score（一致性）

| 检查项 | 判定依据 | 权重 |
|---|---|---|
| Component 一致性 | 同类结构必须用同一来源：DS 实例 / create-local Frame 二选一，禁止同类混用 | 30% |
| spacing | 相同层级元素的 padding/gap 实测值档位唯一（同类卡片 padding 不得出现 12 与 16 混用） | 25% |
| radius | 全页圆角值 ∈ radius.scale（sm/md/lg），异常值（5/7/11px）计数 | 20% |
| typography | 字号/行高/字重 ∈ typography 五档，档外值计数 | 15% |
| icon 风格 | 线性/面性统一，尺寸 ∈ {16,20,24}，禁止第三方图标混入 | 10% |

### 1.4 Commercial Score（商业感）

模拟高级 UI 设计师评审，锚点比对：**Apple（克制的层级与留白）/ Stripe（数据密度与排版）/ Linear（暗色与强调色纪律）/ Ant Design Pro（后台信息流）/ Material 3（状态与圆角语义）**。

| 检查项 | 判定依据 | 权重 |
|---|---|---|
| 商业产品相似度 | 与锚点产品的同场景截图/规范并置比对：间距节奏、圆角纪律、层级呼吸感 | 40% |
| 模板感 | 剪贴画式占位（随机 unsplash 图、lorem 文本、默认蓝按钮）= 直接 ≤5 分 | 25% |
| 品牌识别 | primary 是否贯穿：导航激活态/关键 CTA/数据高亮至少 3 处呼应 | 20% |
| 细节完成度 | 阴影/描边/状态（hover/active/disabled）是否成体系而非零散补丁 | 15% |

**规则：Commercial 维的 issue 必须给出可执行的对照描述**（"KPI 卡缺环比箭头，Ant Design Pro 同场景有 trend icon"），禁止"不够高级"这类无法回写的话术。

### 1.5 Usability Score（可用性）

| 检查项 | 判定依据 | 权重 |
|---|---|---|
| 信息层级 | 首屏 F 型/Tab 流扫描：每屏恰有 1 个视觉焦点，text.primary/regular/secondary 使用比例健康 | 25% |
| 操作路径 | 核心任务 ≤3 步可达（TabBar 页面核心功能必须首屏直达） | 25% |
| CTA 明确度 | 每屏主 CTA 唯一且视觉最强（primary 实心 > 次级描边 > 文字链） | 20% |
| 移动端触控 | 可点击元素 ≥44×44（AC-2 红线，web-admin 放宽 ≥28）；readback 实测 | 20% |
| Dashboard 信息流 | 数据页遵循 总览→分解→明细 的阅读顺序，图表轴/图例齐全 | 10% |

---

## 2. 评分锚点

| 分值 | 含义 |
|---|---|
| 9–10 | 达到锚点产品水准，可直接交付 |
| 8–8.9 | 商业可用，存在低风险改进点（允许 PASS） |
| 7–7.9 | 有明确缺陷，必须生成 issue 并修复（不得 PASS） |
| 5–6.9 | 系统性缺陷（多节点同因），需回写 token/组件层 |
| <5 | 结构性问题，需回写 L1 重审方向 |

**汇总规则**：
- `average` = 五维算术平均（half-up，一位小数）
- `average ≥ 8` 且无单项 < 7 → `action = PASS`
- 任一单项 < 7 → 必须生成对应 issue（severity ≥ medium），`action = FIX`
- `average < 8` 但全部单项 ≥ 7 → 可判 FIX（带 medium issues）或 PASS（仅 low 级建议），必须二选一写明理由

---

## 3. Critic Loop 规则

```
Round 0  L3 生成页面（初始 build）
Round 1  Critic 审查 → Report → 发现问题 → 按映射路由回写
Round 2  只修改受影响 token / component / 节点（禁止整页重建）
Round 3  最终评分 → 终审报告
```

硬性约束：

| 规则 | 内容 |
|---|---|
| CL-1 | `average ≥ 8` 且无单项 <7 → PASS，立即停止循环 |
| CL-2 | 任一单项 <7 → 必须生成修正建议（issue），进入修复 |
| CL-3 | **最多循环 3 次**（Round 1/2/3 各一次审查修复机会）；Round 3 仍未达 PASS → `action = STOP_MAX_LOOP`，输出差距清单转人工 |
| CL-4 | **禁止无限自动优化**：达到 CL-3 上限后禁止继续自动修改；禁止"顺手多改"——修复范围严格等于 issues 涉及的 token/component/节点 |
| CL-5 | 每轮修复后必须**重新审查受影响页**并记录 history（各轮 average），禁止只修不评 |
| CL-6 | 修复动作必须走 critic-mapping.md 路由，禁止跨层私改（如绕过 L2 直接在 L3 改死色值） |

Report 中 `_loop` 字段记录轮次与历史均分，QA 校验 `round ≤ 3`。

## 4. 审查执行方式

1. **结构化优先**：Layout/Color/Consistency/Usability 全部基于 get-node 读回数据判定（该通道已通过端到端验证）；
2. **视觉补充**：PNG 导出供人工/多模态复核，Commercial 维以结构化证据 + 锚点比对为主，PNG 目视为辅；
3. **逐页产出**：每页一份 Report（`project + page` 唯一），禁止多页合并；
4. **证据可复查**：issue.evidence 必须包含实测值与规则出处，审查者可按 evidenceNodeIds 回放。

## 5. 与其他层的关系

- 输入依赖：L3 的 export（PNG/SVG）+ build-ids 快照 + L2 DS Spec（白名单/档位/触控红线）
- 输出去向：`critic-mapping.md` 路由 → L1（designDirection/visualSystem）/ L2（token/组件规格）/ L3（Build Plan/节点重建）
- 回写后重走受影响层的 stage gate；L2 回写必须重跑 DS Spec QA 脚本

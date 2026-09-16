# Critic Mapping — issue → targetLayer 路由规则

Visual Critic 的每条 issue 必须路由到**唯一**一层（L1/L2/L3），路由决定修复发生的位置与 stage gate。本文件是 `visual-critic.md` CL-6（禁止跨层私改）的判定依据。

> **关于本文提到的 QA1–QA7**：指 `SKILL.md` L5 的**交付物出口检查清单**（Schema / 文件存在 / node id 回读 / 映射完整 / Token 回溯 / 无孤儿 / 冻结零修改）。**本 Skill 不随包附带校验脚本**，各条均为人工逐条核对——不要因为它出现在流程描述里，就认为已被自动执行。

## 1. 三层职责边界（先分层，再路由）

| 层 | 拥有的东西 | 回写能改 | 回写不能改 |
|---|---|---|---|
| **L1** Design Intelligence | designDirection（风格路由）、visualSystem（色/字基线）、IA（页面清单）、行业映射 | Style Preset 选择、designDirection 字段、IA 页面增删 | 任何具体色值/字号/节点（那是 L2/L3 的） |
| **L2** DS Generation | tokens（五件套+source）、组件决策矩阵（CD-1~4）、状态矩阵、layout zones、触控红线 | token 值（须重算 derived）、组件 decision/states/规格（height/padding/radius） | 新增非白名单色值；跳过 stage gate 直接改 L3 |
| **L3** Figma Build | Build Plan 批次、节点树、实例、readback 快照 | 受影响节点的重建/移动/覆写、Build Plan 批次划分 | 绕过 token 直接改死值；改 DS 单源结构 |

## 2. 路由判定表（自问顺序）

依次回答四个问题，命中即停：

```
Q1 症状是"方向错了"吗？（风格不匹配场景 / 品牌气质偏 / 页面该有而没有）
   → targetLayer: L1  → 改 Style Preset 或 designDirection，触发 L2 重生成受影响部分
Q2 症状是"规格错了"吗？（尺寸/padding/radius/字号/色值/状态缺失，且同类元素普遍偏离）
   → targetLayer: L2  → 改 token 或组件规格，重算派生值，重跑 L2 出口检查
Q3 症状是"实现错了"吗？（规格本身对，个别节点位置/缺失/覆写未生效/漏建）
   → targetLayer: L3  → 只重建受影响节点，更新 build-ids，重跑 QA
Q4 都不是？（issue 表述含糊）
   → 打回 Critic 重写 evidence，禁止带病路由
```

## 3. 典型映射示例

| 问题（issue） | targetLayer | 修复动作 | 回写验证 |
|---|---|---|---|
| 按钮高度不足（<44 触控红线） | **L2** | 改 Button.height 规格（token/组件参数） | 重跑 L2 出口检查 + L3 重建按钮节点 |
| 卡片 padding 12px 低于 token 最小档 | **L2** | 调 spacing token 或组件 cardPadding 引用 | derived 复算 + 重建引用该 token 的卡片 |
| 页面元素位置错误 / 节点漏建 | **L3** | 改 Build Plan 批次，重建受影响节点 | get-node READBACK 复核 + QA1/QA3 复测 |
| 实例文本覆写未生效 | **L3** | set-text-content 覆写 + rename | readback 字段比对 |
| 出现 unknownColors（如 #D9D9D9） | **L2** | 映射到最接近的白名单 token（或评审新增 token，须带 source） | QA4 重扫 unknownColors=[] |
| 整体风格不高级 / 不像政务大屏 | **L1** | 切换/调整 Style Preset / designDirection | L1 stage gate → L2 重新生成受影响层 |
| 页面清单缺页（IA 缺口） | **L1** | 补 informationArchitecture.pages | Brief schema 校验 → L2/L3 增量生成 |
| glow 阴影用于非关键指标 | **L2** | 收紧 shadow.glow 的 usage 约束 | L2 QA + L3 重建 misuse 节点 |
| 深色底对比度 < 4.5:1 | **L2** | 调 text token 值（同色相加深/提亮），重算派生 | WCAG 复算 + 重扫 |

## 4. 回写流程（CR-1 ~ CR-5）

| 规则 | 内容 |
|---|---|
| CR-1 evidence-first | 无 evidence 的 issue 不允许路由（模板里 evidence 必填，QA 强制） |
| CR-2 单层路由 | 一个 issue 只路由一层；跨层问题拆成多条，各自路由 |
| CR-3 最小影响面 | 回写只触碰 issues 涉及的 token/组件/节点；禁止顺手重构（对齐 CL-4） |
| CR-4 层内约束 | L1 回写必须重新过 L1 stage gate；L2 回写必须重跑 L2 出口检查（新色值必须带 source）；L3 回写必须 WRITE→READBACK 并更新 build-ids |
| CR-5 修复必复评 | 修复后必须重新 Critic 受影响页并更新 `_loop.history`；禁止只修不评 |

## 5. severity 与路由的联动

- `critical`（结构性：整页 HUG 塌缩、DS 单源被破坏）→ 必须路由 L3 或 L2，禁止 PASS
- `high`（红线：unknownColors、触控 <44、对比度不达标）→ 必须出 issue；路由层由判定表决定，多为 L2
- `medium` → 常规修复项，L2/L3 为主
- `low` → 建议性，可随下一轮修复顺带处理，不阻塞 PASS

# brief-schema.md — Design Brief JSON Schema 说明

Schema 正本：`templates/design-brief.json`（JSON Schema draft-07）。本文件是字段级填写规则。

## 五大字段

### product（产品事实）
- `name`：用户提供则照抄；未提供则按「行业 + 形态」生成占位名（如「智慧养护决策平台」）并写 `_assumptions`。
- `industry`：枚举 教育 / 医疗 / 政务 / 交通 / 金融 / 美业 / 快消 / 电商 / 通用；多行业取主业务。
- `platform`：枚举 web-admin / web-site / mobile-app / big-screen。

### designDirection（设计方向）
- `style`：Style Preset id，**只能**是四套之一（premium-saas / enterprise-dashboard / gov-digital-screen / web-marketing）；扩展 Preset 是 Skill 版本变更，不是运行期决定。
- `keywords`：≥3 个中文设计关键词，从 Preset keywords + Prompt 提取，禁止编造 Preset 外的风格承诺。
- `reference`：对标产品/设计语言名（Apple、Stripe、Element Plus…），来自 Preset 的 reference 字段。
- `avoid`：**基线是 Preset 的完整 avoid 列表**——这是 L4 Critic 的否决依据。
- `avoidOverrides`：用户显式点名了与 Preset `avoid` 冲突的手法时，记录被剔除项 `{ item, reason }`；`item` 必须原样出现在原 Preset 的 avoid 中，`reason` 固定格式 `"用户显式要求：<原文片段>"`。**无覆盖时也必须输出空数组**（表明已仲裁）。仲裁规则见 design-intelligence.md §⑧——只剔除、不新增，且不得豁免 token 白名单/对比度/触控等硬性规则。

### informationArchitecture（信息架构）
- `pages[]`：≥3 项，每项 name/purpose/layout；purpose 必须回答「这页解决用户什么问题」。
- `layoutPattern` / `contentDensity`：从 Preset 继承，行业/平台修正见 design-intelligence.md §②④。

### visualSystem（视觉系统）
- 所有 hex 字段 `^#[0-9A-Fa-f]{6}$`；**值必须有出处**（Preset visualSystem、行业映射 primaryColor、或用户显式提供的品牌色）。
- 用户显式给出品牌色时，它以最高优先级写入 `primaryColor`，并在 `_assumptions` 标注来源；此时禁止再借其它行业的点缀色顶替。
- `typography` 格式：`字体族 / 字阶序列`，且字体族**必须是降级链而非单一族名**（如 `Inter（PingFang SC → Microsoft YaHei → Inter 兜底）/ 26-32-16-14-13-12-11`）。原因：Windows 的 Figma 没有 PingFang SC / SF Pro。
- `spacing` 格式：`基数 + 档位`（如 `8pt 网格 (4/8/12/16/24/32)`）。
- `radius` 格式：斜杠分隔档位（如 `4/6/8`）。

### componentExpectation（组件预期）
- ≥5 项，≤20 项；`priority` 三级：P0 必须 / P1 应该 / P2 可选。
- P0 = Preset coreComponents 全集；P1 = 行业追加 + Prompt 显式功能；来源必须可追溯。

### _assumptions
- 只收「规则未覆盖的假设」；规则命中的判断禁止写入（污染审计）。
- 每条格式：`"字段路径: 假设内容（原因）"`。

## 校验清单（L1 Stage Gate 第 1 项的执行方法）

```bash
python -c "import json;json.load(open('<brief>.json',encoding='utf8'));print('OK')"
```
再人工核对：① 五大字段齐全 ② hex 合法 ③ avoid 已按 design-intelligence.md §⑧ 仲裁（无冲突时 `avoidOverrides` 为空数组；有覆盖时被覆盖项确已从 `avoid` 剔除） ④ componentExpectation 的 P0 与 Preset coreComponents 一致 ⑤ assumptions 只含假设 ⑥ typography 含字体降级链而非单一族名。

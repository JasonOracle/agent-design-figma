# brief-schema.md — Design Brief JSON Schema 说明

Schema 正本：`templates/design-brief.json`（JSON Schema draft-07）。本文件是字段级填写规则。

## 五大字段

### product（产品事实）
- `name`：用户提供则照抄；未提供则按「行业 + 形态」生成占位名（如「智慧养护决策平台」）并写 `_assumptions`。
- `industry`：枚举 教育医疗政务交通金融美业电商通用；多行业取主业务。
- `platform`：枚举 web-admin / web-site / mobile-app / big-screen。

### designDirection（设计方向）
- `style`：Style Preset id，**只能**是三套之一（premium-saas / enterprise-dashboard / gov-digital-screen）；扩展 Preset 是 Skill 版本变更，不是运行期决定。
- `keywords`：≥3 个中文设计关键词，从 Preset keywords + Prompt 提取，禁止编造 Preset 外的风格承诺。
- `reference`：对标产品/设计语言名（Apple、Stripe、Element Plus…），来自 Preset 的 reference 字段。
- `avoid`：**必须完整继承 Preset 的 avoid 列表**——这是 L4 Critic 的否决依据。

### informationArchitecture（信息架构）
- `pages[]`：≥3 项，每项 name/purpose/layout；purpose 必须回答「这页解决用户什么问题」。
- `layoutPattern` / `contentDensity`：从 Preset 继承，行业/平台修正见 design-intelligence.md §②④。

### visualSystem（视觉系统）
- 所有 hex 字段 `^#[0-9A-Fa-f]{6}$`；**值必须有出处**（Preset visualSystem 或行业映射 primaryColor）。
- `typography` 格式：`字体族 / 字阶序列`（如 `Inter / 26-32-16-14-13-12-11`）。
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
再人工核对：① 五大字段齐全 ② hex 合法 ③ avoid 继承完整 ④ componentExpectation 的 P0 与 Preset coreComponents 一致 ⑤ assumptions 只含假设。

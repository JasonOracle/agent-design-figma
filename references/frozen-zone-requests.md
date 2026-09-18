# 冻结区需求单（D 组 · 2026-09-18 归并定稿）

**性质**：本单是**需求文档**，不是改动记录。`figma-plugin/` 与 `bridge/` 是冻结区
（`qa-export` QA7 构建期禁改，运行 A #11 的拦截是先例）——**本单全部条目在用户显式批准解冻之前一行代码都不动**。
批准后的执行方式见 §3。

**共同前提**：所有条目都是 **additive**（新增回读字段 / 新增错误码语义），不改动既有 33 字段契约
（`references/design-criteria-intake.md` §1.5）的任何既有键 ⇒ 对既有产物与闸门**零破坏**；
每条落地后用 `tools/contract-usage.mjs` 复核字段计数（33 → 期望值见各行）。

---

## 1. 需求清单（6 条，按性价比排序）

| # | 需求 | 落点（冻结区具体位置） | 解锁什么 | 验收方式 | 风险 |
|---|---|---|---|---|---|
| **FR-1** | `ping` 回传 `figma.fileKey` | `code.js` 的 ping handler（`figma.fileKey` 为插件 API 现成常量，一行取值） | L5 `live-build` 档位在本环境**结构性不可达**（D2，两次独立确认）→ 闸门恢复完整语义 | `qa-export` 对真清单复跑：`figmaFileKey` 非空；`qa-plugin` 自测加断言 | **最低**——API 现成 |
| **FR-2** | `get-node` 文本节点回传**数值 `fontWeight`**（现只有 `fontName.style` 字符串如 `SemiBold`；Figma 侧可用 `getRangeFontWeight` 或 style→数值映射表） | `code.js` 文本序列化段（`nodeInfo` 的 `const info = {…}`） | better-typography 2 条：「18px 以下字重 ≥400」「300 以下只配 28px+」 | `contract-usage` 字段计数 +1；变异喂混合字重文本断言数值 | 中——混合字重节点需定取值口径（建议：全节点一致才回传，混排回传 `null` + `mixed` 标记） |
| **FR-3** | `get-node` 回传 `lineHeight`（Figma 原生 `{value, unit}`，直接序列化） | 同上 | better-typography「行高按角色（1.1 / 1.5–1.6 / 换行 ≥1.4）」；替代路径「单行 height÷fontSize 反推」**明确不采用**（多行需估行数，误报风险同类「从 padding 反推内边距」） | 同上 | 低——原生字段直取 |
| **FR-4** | `get-node` 回传 `letterSpacing`（原生 `{value, unit}`） | 同上 | better-typography「字距按字号」——**半档**：规则原文未给值（"often look better"），补字段后也只能到「译」档，`assumptions` 照记 | 同上 | 低 |
| **FR-5** | `paintToHex()` 回传**填充级 `paint.opacity`**（实测复核：`opacity:0.5` 的 paint 回读只剩 `fills=["#e6e6e6"]` + 节点级 `opacity=1`，paint 级透明度**无处承载**） | `code.js` 的 `paintToHex`（建议 `fills=["#e6e6e6@0.5"]` 后缀写法或平行数组，二选一在实现时定） | L4「材质一致性」的结构化通用档证据（D1）；C1 的 `pixel-proof` 像素通道仍保留为兜底，两者互证 | `contract-usage` 字段计数；变异喂半透明填充断言回读值 | 低 |
| **FR-6** | `get-node` 对**未知 id 快速失败 `NODE_NOT_FOUND`**（现状：`dynamic-page` 下挂满 10s 后由 Figma 宿主抛「无法连接 Figma，请检查网络」——代码里 `if (!node) throw NODE_NOT_FOUND` 分支**永不触发**，D3） | `code.js` 的 `getNodeByIdAsync` 包装：先查 `figma.root.children` 页面归属或 try-catch 宿主错误改写语义 | ① 诊断方向修正（不再把「id 不存在」说成「网络问题」）；② `precheck --live` 的「核出不存在」路径**在本环境首次可用**；③ 缺失 id 核对从 ~10s 降到即时 | `precheck --live` 变异的 mock 语义与真插件对齐；真环境喂 `999:999` 断言快速 NODE_NOT_FOUND | **最高**——涉宿主行为，需真机验证 `dynamic-page` 下的可行路径；实现时若证实无法快速判定，**如实降级为「保持现状 + 文档标注」**，不硬造 |

**优先级依据**：FR-1 一行解锁一档闸门；FR-2/3 一次加两字段解锁 2~3 条规则（性价比最高的一笔，
`1.3-candidates.md` §F4）；FR-4 半档但顺手；FR-5 补「不可观测」的最后缺口；FR-6 收益大但风险也大，放最后单独验证。

## 2. 与既有记录的对应

| 本单 | 原记录 |
|---|---|
| FR-1 | `1.3-candidates.md` **D2**（断言侧已由 D4 判据修正消除，本条补的是**凭证本身**） |
| FR-2/3/4 | `1.3-candidates.md` §F4「本轮新增的 D 组需求单」三条；`lessons.md` #87 |
| FR-5 | `1.3-candidates.md` **D1**（落点已改判冻结区） |
| FR-6 | `1.3-candidates.md` **D3**；`lessons.md` #76 |

## 3. 批准后的执行纪律（预写，批准即生效）

1. **一次解冻窗口**：用户批准明确到条目（「做 FR-1/FR-3」这类），**没点名的条目不动**；
2. 每条**独立提交**，提交信息带 `FR-x` 编号；改完当轮**复跑全套闸门**（check-refs / qa-export /
   变异 ×N / contract-usage），任何既有断言变红即停；
3. FR-6 必须在**真 Figma 环境**实测通过才算数（mock 证明不了宿主行为）；
4. 全部完成后本单逐条回填「✅ 已做 + 提交号」，QA7 恢复冻结。

---

## 4. 结案记录（2026-09-18 · 用户批准全部 6 条，一次解冻窗口）

| # | 结果 | 提交 | 备注 |
|---|---|---|---|
| FR-1 | ✅ 已做 | `3953e48` | `ping.fileKey`；真机验证：键在（未保存草稿 null 属正常） |
| FR-3/4 | ✅ 已做 | `7acd368` | 原生 `{value,unit}` 直传；混排回 `null`；真机：默认 `{unit:"AUTO"}` / `{value:0,unit:PERCENT}` |
| FR-2 | ✅ 已做 | `6bf8211` | `STYLE_WEIGHTS` 逆映射（与 `WEIGHT_STYLES` 同源）；混排回 `null`；真机：Regular→400、**Bold→700** |
| FR-5 | ✅ 已做 | `bb770ac` | 采用**平行数组 `fillOpacities`**（§1 建议的后缀写法不采用——会砸到 anchor-compare 消费方）；真机：`[0.5]` 回包+独立回读一致 |
| FR-6 | ✅ **复核结案：需求已在既有代码中满足** | 无需提交 | 真机实测 `999:999` → **418ms** 快速失败 `NODE_NOT_FOUND`（无 10s 挂起、无误报网络）。§1 FR-6 行的「现状」描述是**时点快照已过期**（#10 教训：动手前回指产物复核）——`getNode` 现版（`getNodeByIdAsync` + null 即抛）早已正确；当年观察到的「网络问题」表象疑为旧版插件或插件离线（bridge 侧 `PLUGIN_OFFLINE`）与宿主错误混淆 |

**契约计数**：33 → **38**（imageFills / lineHeight / letterSpacing / fontWeight / fillOpacities，
`contract-usage.mjs` 当场实测为准）；`fillCount`、`fillOpacities` 等被 qa-plugin 读取的字段已按判据③移出 `UNUSED_OK`。
**真机验证口径注**：FR-3 首测期待值写错（AUTO 是合法三态）、FR-5 首测参数形状写错（透明度须在颜色 spec 内）——均非代码缺陷。
QA7 冻结恢复。

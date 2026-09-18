# 锚点并置比对协议（F3②）

> 装置：`tools/anchor-compare.mjs` ｜ 变异测试：`tools/anchor-compare-mutation.mjs` ｜
> 报告 Schema：`assets/templates/anchor-compare-report.json`
>
> 修的环：Commercial「商业产品相似度（40% 权重）」此前**结构性无法评估**——运行 B 的 L4 报告
> 未评它的理由是「需与锚点产品同场景并置比对」，而链路里**没有装置**做这个比对
> （`1.3-candidates.md` F3 来历第 3 条）。本协议把「并置比对」从一句要求变成可执行、可回放的五步。

## 一、锚点源（外部、可选、不 vendored）

| 项 | 结论 |
|---|---|
| 源 | https://github.com/nexu-io/open-design 的 design-systems 目录下每品牌一份 DESIGN.md 设计契约（2026-09-18 核实：**151 个品牌包**，另 plugins/_official/design-systems 下 143 个插件化包装） |
| 形态 | 每品牌一份 Markdown 设计契约：色板（反引号 hex + 角色名）、字阶层级表、字族、组件样式、断点——**机器可解析**（S1.5 前提实测成立，见 §四） |
| 许可 | 仓库主体 **Apache-2.0**；个别子目录另有 LICENSE。引用必须记 `--license`（工具 J2 强制） |
| 为什么不 vendored | 许可证连带责任 / 上游会漂 / 151 份体积。⇒ 立项书里「随包锚点集」的措辞据此**改判**：随包的是**协议与装置**，锚点集是外部可选源 |
| 快照纪律 | 结论必须能回放到**具体快照**：工具对快照内容算 sha256，连同来源 URL、许可证、取用日期一起写进报告（J5）。「像不像」只对「当时那份」负责 |

## 二、并置协议（五步）

1. **选锚**（人做，不机械化）：按产品定位选同类品牌。选错锚 = 比对无意义——这一步是判断，装置不替你判断。
2. **快照**：取当时那份 DESIGN.md 存进运行目录（如 `.vibe/<run>/anchors/<brand>.DESIGN.md`）。工具算 sha256。
3. **提取**：锚点侧解析「**声明的 token**」（色板 / 字族 / 字阶）；画布侧从回读解析「**实际用的 token**」（fills+strokes 的 hex / fontName.family / fontSize）。
4. **比对**：逐 token 算差。色 = RGB 欧氏距离（**粗糙代理，非感知色差**——报告里如实标注）；字族 = 集合差；字号 = 命中/板外清单。
5. **留痕**：产出 `anchor-compare-report.json` 供读图项 R11 与 Commercial 评分引用。相似度结论 = R11 + 人，**不是本工具给分**。

**画布侧的形态前提（S1.5，实测 2026-09-18）**：`get-node` 回读的 `fills` 是 **hex 字符串数组**（`paintToHex` 产物），
运行 B 377 节点中 373 个带 `fills` 键、367 个有实际色值、全树 13 个不同 hex——前提成立。
注意 §1.5 契约表上一轮已订正：「谁在读」与「能不能读」是两回事；本装置是 `fills` 的**第一个几何之外的消费者**。

## 三、装置的判据（J1–J5，FAIL 即 exit 1）

| # | 判据 | 为什么 |
|---|---|---|
| J1 | `--source` 必须是 http(s) URL | 没有来源的快照无法回放，比对结论不得产出 |
| J2 | `--license` 必须非空 | 引用外部素材不记许可证 = 不可分发地引用 |
| J3 | 锚点解析出 **≥3 色 且 ≥1 字族** | 解析不出 ≠ 「锚点很素」，是提取失败或拿错文件；空锚点比对 = 假证据 |
| J4 | 画布解析出 **≥1 色 且 ≥1 字族** | 画布没 token = 结构性无法比对，如实失败；不许空报告被读成「比对过没问题」 |
| J5 | 快照 sha256 写进报告 | 能回放 = 有哈希 + 有来源 + 有日期（四件套） |

判据全部是「**装置有没有如实运转**」，没有一条是「像不像」——H3 零目测评分：分数属读图与人的判断，
装置只负责让那个判断**有可回放的证据**。变异测试 43 条断言两侧夹（应抓错 8 组 + 应放过 + 报告内容 + 纯函数单测）。

**提取的两个实测签名**（变异测试钉住）：

- 字族只能来自「第 3 列含 px」的层级表（这是字阶表的形态签名）+ `**Primary**:` / `**Monospace**:` 显式标记。
  不设签名，阴影表的 `rgba(...)` 与断点表的 `640–768px` 会混进字族（首轮真跑即中招）。
- `#fff` 三位 hex 要扩展成 6 位再比（同一色两种写法不能算两个 token）。

## 四、运行 B × linear-app 的首批实测（2026-09-18）

```
node tools/anchor-compare.mjs .vibe/d2-run-b/readback.json \
  --anchor .vibe/d2-run-b/anchors/linear-app.DESIGN.md \
  --source https://raw.githubusercontent.com/nexu-io/open-design/main/design-systems/linear-app/DESIGN.md \
  --license Apache-2.0
```

- 画布 13 色：**1 色精确命中**（`#ffffff`），12 色板外（最近距 147.3，均距 65.5）；主色 `#00d4ff`（×164）距锚点板最近 129.8。
- 字族：画布 `Inter` + `Microsoft YaHei`，锚点声明 `Inter Variable` + `Berkeley Mono` —— 命中 0/2（`Inter` ≠ `Inter Variable`，装置按字面比，**不猜**；这个差本身就是给读图的线索：锚点用的是变量字体）。
- 字号：画布 4 档，命中锚点字阶 2 档（板外 22 / 26）。
- 读法示例：均距 65 且主色板外 ⇒ 「与 linear-app 的色彩重合度低」是**有数字的证据**，Commercial 评分时不再「单图凭感觉」。

## 五、边界（装置不做什么）

- **不给相似度分**（H3）；聚合多锚点成单一分数更是把判断藏进算术——禁止。多锚点 = 多份报告并列供读。
- **不选锚**：选锚是产品定位判断（协议第 1 步），装置不替人选。
- **不做「应像」断言**：画布与锚点不同 ≠ 错——报告只有差值，没有违规。违规与否属 R11 的 verdict + 人。
- **structured-only 下 Commercial 仍不可评**：本装置产出的是结构化**色/字证据**（可进 `_evidence`），
  「观感相似」仍需读图。qa-critic QA7 的「structured-only 必有 unassessed」**不变**。

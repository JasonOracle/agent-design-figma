# bridge-ops.md — Bridge 写通道 op 参考

本文件是 L3（自动绘制进 Figma）的**唯一 op 权威清单**。执行任何写操作前先读本文件——op 名与参数形状必须照抄，不要凭印象构造。

> 为什么需要这份文件：本仓库此前没有任何 op 文档，Agent 只能去读 `figma-plugin/code.js` 源码反推参数。
> 由此产生过一次真实的 P0 事故——`set-effects` 给模糊类效果多写了 `color` 字段，导致毛玻璃场景全灭
> （详见 §6）。参数形状是契约，不是建议。

---

## 1. 通信契约

Bridge 是本地回环 HTTP 服务（默认 `127.0.0.1:45677`，`--port` 可改），只绑回环，不接受局域网访问。除 `/health` 外**每个请求都要带 token**：`?token=<token>` 或请求头 `x-vibe-token`。token 在启动 Bridge 时打印，默认也存在 `<repo>/.vibe/token`。

> **取 token 的正确姿势：以启动日志打印的那一行为准。**
> `.vibe/token` 只在**未指定 token** 时才会被写入/读取。若启动时带了 `--token <值>` 或设了
> 环境变量 `VIBE_TOKEN`（`loadOrCreateToken()` 的前两条返回路径），它们**直接生效且不落盘**
> ——此时 `.vibe/token` 里是**上一次的旧值**，照它取值会 401。`--token` / `VIBE_TOKEN` 是为
> **测试与临时隔离实例**设计的（各 QA 脚本都这么起，正是为了不污染你的 `.vibe/token`）。
> 见 `references/lessons.md` #49。

| 端点 | 用途 |
|---|---|
| `GET /health` | 公开只读探活（无 token）。含 `plugin.connected`、`queue`、`recent`、`endpoints` |
| `POST /v1/command` | 提交**单条** op 并同步等待真实执行结果 |
| `POST /v1/batch` | 提交**多条** op，按批执行（推荐；见 §3） |
| `GET /v1/history?n=20` | 最近命令历史（排查"到底跑没跑"） |
| `GET /v1/poll` · `POST /v1/result` · `POST /v1/hello` | 插件专用，Agent 不调用 |

单条 op：

```bash
curl -s "http://127.0.0.1:45677/v1/command?token=$TOKEN" \
  -H 'content-type: application/json' \
  --data-binary '{"op":"create-frame","params":{"name":"首页","width":390,"height":844}}'
```

**语义保证**：`/v1/command` 与 `/v1/batch` 都是**同步**的——只有插件真的执行完（成功或失败）才回包。永远不要写"已提交/排队中"就当作成功。

失败返回 `ok:false` + `error.code`，HTTP 状态码：`503` = 插件不在线，`504` = 超时/未被拾取，`400` = 参数或执行错误。

---

## 2. 通用约定

### 2.1 颜色写法（所有 `fill` / `stroke` / `color` 字段通用）

| 写法 | 示例 |
|---|---|
| 十六进制 | `"#5A5CF0"`、`"#fff"` |
| RGB 数组（0–255） | `[90, 92, 240]` |
| 带透明度对象 | `{"hex":"#FFFFFF","opacity":0.72}` ← **毛玻璃填色的唯一正确写法** |
| 同上简写 | `{"rgb":[255,255,255],"opacity":0.72}` |
| 等价键名 | `color` 与 `fill` 在 `set-fill` 里等价；`stroke` 与 `color` 在 `set-stroke` 里等价 |

清空填色/描边用 `{"clear":true}`。

### 2.2 节点引用

多数 op 的 `id` 接受 Figma node id（`"123:456"`）。在 `run` 批量内还可以用 `"@last"` 与 `"$name"`（见 §3）。**引用型字段白名单**（只有这些字段能接引用，写在别处会报错）：

`id` / `parentId` / `childId` / `nodeId` / `componentId` / `targetId` / `from`

### 2.3 读取：`depth` 与 `detail`

`get-node` 的两个参数互相独立，不要混用：

| 参数 | 语义 |
|---|---|
| `depth` | 向下读几层。`0` = 不带 children；`1`（默认）= 直接子级；`2` = 含孙级，依此类推 |
| `detail` | 子级是否携带完整样式态（宽高坐标/填色/自动布局/字体）。`false`（默认）时子级是轻量壳 `{id,name,type}` |

**注意**：`depth:1`（默认）时子级始终是轻量壳——想看孙级必须 `depth ≥ 2`。做 L4 Layout 审查要"逐节点实测"时，用 `{"depth":3,"detail":true}` 一次取全，不要每个节点打一次 roundtrip。

### 2.4 常见错误码

| code | 含义与处理 |
|---|---|
| `PLUGIN_OFFLINE` | 插件没开/已崩。让用户重跑插件再试，**不要**重试循环 |
| `NODE_NOT_FOUND` | 引用的 id 不存在（常见于上一轮重建后仍用旧 id）→ 重新 `get-page-summary` 取新 id |
| `BAD_PARAM` | 参数形状不对 → 对照本文件 §5 |
| `NOT_A_TEXT_NODE` / `NO_FILL` / `NO_EFFECTS` | 该节点类型不支持此属性（如给 RECT 设字体） |
| `MIXED_FONT` | 一个文本节点混了多种字体 → 先 `set-font` 统一 |
| `STEP_FAILED` | `run` 批量内某一步失败，`error.partial` 里是该批**已成功**的步骤 |

---

## 3. 批量：`POST /v1/batch`（重要）

一个 296 op 的页面构建如果逐条调用 `/v1/command`，就是 296 次长轮询往返、1~2 分钟纯等待。用 batch 把同样的构建压到个位数往返。

```jsonc
POST /v1/batch
{
  "steps": [ {"op":"create-frame","params":{...}}, {"op":"set-fill","params":{...}} ],
  "chunkSize": 40,              // 可选，默认 40，上限 200。每个 chunk = 一次插件 run
  "onError": "abort",           // 可选，abort（默认）| continue
  "timeoutMs": 15000            // 可选，作用在**每个 chunk** 上
}
```

返回：

```jsonc
{
  "ok": false,
  "status": "partial",          // ok | partial | failed
  "steps": 296, "chunks": 8, "chunksRun": 2, "executed": 100, "remaining": 195,
  "results": [ { "step": 0, "op": "create-frame", "ok": true, "data": {...} } ],
  "failedAt": { "chunk": 2, "step": 100, "op": "create-rect", "code": "STEP_FAILED", "error": "..." },
  "referenced": false,
  "elapsedMs": 4210
}
```

要点：

1. **`results[].step` 是全局序号**（不是 chunk 内序号），可直接与你的 steps 数组下标对齐。
2. **失败可续**：`failedAt.step` 就是断点，它之前的成果都真的画进画布了。重跑时从这一步接着提交，不要整页重建。
3. **`onError`**：`abort` = 停在断点、后续 chunk 不发（默认，安全）；`continue` = 失败 chunk 的剩余步骤跳过、后续 chunk 照跑（适合"多页独立生成，坏一页不拖累其他页"）。
4. **`chunkSize` 与引用互斥**：只要 batch 里出现 `@last` / `$name`，跨 chunk 的引用命名空间会断，Bridge 会自动把整批当**一个 chunk** 执行并在 `referenced:true` + `note` 里说明。想要分片提速，就把一个 chunk 内的步骤写成**不依赖前序引用**（自己保存 id 再显式传入）。
5. `run` 不能作为 step 出现（batch 已经是批量），嵌套会被拒绝。

### 3.1 `run` 批量内部的引用语法（单独用 `/v1/command` 调 `run` 时）

```jsonc
{ "op": "run", "params": { "ops": [
  { "op": "create-frame", "params": {"name":"卡片","width":320,"height":180}, "as": "card" },
  { "op": "set-fill",     "params": {"id":"@last","fill":"#FFFFFF"} },
  { "op": "create-text",  "params": {"characters":"标题","parentId":"$card"} }
] } }
```

- `"@last"` = 上一步创建的那个节点。
- `"$name"` = 之前某一步用 `as: "name"` 声明过的节点。**只有 `create-*` 类 op 支持 `as`**。
- `run` **fail-fast**：某步抛错就中止，`error.partial` 返回已成功的步骤。

---

## 4. L3 推荐手法（三条硬规则）

### 4.0 开工前：先过预检闸门

```bash
node tools/precheck.mjs plan.json          # 离线：结构 + 参数契约（跑的是真 code.js）
node tools/precheck.mjs plan.json --live   # 再连 Bridge，核对计划引用的画布已有 id 是否存在
```

把**你正要发出去的那串 op**（`{steps:[…]}` / `{ops:[…]}` / 裸数组）先过一遍。它一次报出**全部**静态错误——不必等 `run` 一次只报一个，等到那时画布上已经躺了半张页面。

- 计划样例：`assets/examples/example-health.ops.json`（42 步，覆盖建帧 / 建文 / 建组件 / 实例 / 效果 / 读回）
- **离线查不出**「某个 node id 在画布上到底存不存在」——画布是桩的。这类字面 id 一律列成「待核对」，交给 `--live`
- **`set-effects` 多写的字段会被静默丢弃**（见 §6）——既不报错也不生效，所以只能由预检静态拦

### 4.1 幂等：命名空间前缀 + 重建前清扫

构建中途失败会在画布留下残缺 frame，直接重跑会叠出一堆垃圾。固定流程：

1. 本次构建的所有顶层页框统一前缀，如 `麻辣王子官网 / 首页`。
2. 正式开工前先 `get-page-summary`，把名称匹配该前缀的旧节点全部 `delete-node` 掉。
3. 构建完成再回读校验。

```jsonc
// 第 1 步：清场（把 get-page-summary 返回里匹配前缀的 id 逐个 delete 掉）
POST /v1/batch
{ "steps": [
  { "op": "get-page-summary", "params": {} },
  { "op": "delete-node", "params": { "id": "<上一轮残留 id>" } }
] }
```

### 4.2 字体：先探测再决定，不要一次性选定

`loadFontAsync` 在字体缺失时会直接抛错，整条 `create-text` 失败。**Windows 的 Figma 没有 `PingFang SC` / `SF Pro`**，照抄 macOS 字体名必然失败。

正确流程：

1. 拿 L1 给出的**降级链**（如 `Inter → Microsoft YaHei → 系统兜底`），不要只拿一个族名。
2. 按链顺序依次尝试：首个 `create-text` / `set-font` 成功的胜出。
3. 把**实际生效**的字体写进 build log 与交付说明——不要对外宣称用了链首那个字体。

`create-text` 的 `fontFamily` 省略时默认为 `Inter`（Figma 云字体，跨平台恒可用，CJK 自动走系统回退），是最安全的选择。字重/字形名由插件自动探测，`set-font-weight` 传 `100~900` 即可，不要自己拼 `"SemiBold"`。

### 4.3 分批写入 + 逐批回读

不要一次性 batch 完 296 步就宣布完成。按**页**或**区块**分批：写入一批 → `get-node {depth:2}` 回读该批 → 校验通过再写下一批。理由：`failedAt.step` 只有在批次够小的时候才是有用的断点。

---

## 5. op 清单

共 **36 个 op**（另有 `run` 批量壳）。分组排列。

### 5.1 读取（只读，无副作用）

| op | 参数 | 说明 |
|---|---|---|
| `ping` | — | 连通性 |
| `get-page-summary` | — | 当前页概览 + 顶层节点清单（含 `childCount`） |
| `get-node` | `id`, `depth?`, `detail?` | 单节点详情，见 §2.3 |
| `export-node` | `id`, `scale?`（默认 1）, `format?`（`PNG`\|`SVG`，默认 PNG） | PNG 返回 `base64`；SVG 返回 `svg` 文本 |

### 5.2 创建

| op | 参数 |
|---|---|
| `create-frame` | `name`, `width`, `height`, `x?`, `y?`, `parentId?`, `fill?`, `clips?` |
| `create-rect` | `name?`, `width`, `height`, `x?`, `y?`, `parentId?`, `fill?`, `cornerRadius?` |
| `create-ellipse` | `name?`, `width`, `height`, `x?`, `y?`, `parentId?`, `fill?` |
| `create-text` | `characters`（或 `text`）, `x?`, `y?`, `fontSize?`, `parentId?`, `fontFamily?`（默认 `Inter`）, `fontStyle?`, `name?`, `fill?`, `autoResize?` |
| `create-line` | `name?`, `length`, `width?`（粗细）, `x?`, `y?`, `rotation?`, `parentId?`, `stroke?`, `strokeWeight?` |
| `create-vector` | `name?`, `points?`\|`data?`, `closed?`, `x?`, `y?`, `width?`, `height?`, `parentId?`, `stroke?`, `strokeWeight?`, `strokeCap?`, `strokeJoin?`, `fill?` |

> `create-*` 支持 `as: "name"`，供 batch 内 `$name` 引用。

### 5.3 变换与结构

| op | 参数 |
|---|---|
| `set-name` | `id`, `name` |
| `duplicate-node` | `id`, `name?`, `parentId?`, `x?`, `y?` |
| `move-node` | `id`, `x`\|`dx`, `y`\|`dy` |
| `resize-node` | `id`, `width`, `height` |
| `delete-node` | `id` |
| `append-child` | `parentId`, `childId`（或 `child` / `id`） |

### 5.4 样式

| op | 参数 |
|---|---|
| `set-fill` | `id`, `color`\|`fill`, `clear?` |
| `set-stroke` | `id`, `color`\|`stroke`, `width`\|`strokeWeight`, `clear?` |
| `set-opacity` | `id`, `opacity`（0–1） |
| `set-corner-radius` | `id`, `radius` 或 `topLeft`/`topRight`/`bottomLeft`/`bottomRight` |
| `set-effects` | 见 §6 |

### 5.5 文本

| op | 参数 |
|---|---|
| `set-text-content` | `id`, `characters`（或 `text`） |
| `set-font` | `id`, `family`, `style` |
| `set-font-size` | `id`, `size` |
| `set-font-weight` | `id`, `weight`（100–900）, `italic?` |
| `set-text-color` | `id`, `color`\|`fill` |
| `set-text-align` | `id`, `horizontal?`（`LEFT`\|`CENTER`\|`RIGHT`\|`JUSTIFIED`）, `vertical?`（`TOP`\|`CENTER`\|`BOTTOM`） |
| `set-text-autoresize` | `id`, `mode`（`NONE`\|`WIDTH_AND_HEIGHT`\|`HEIGHT`\|`TRUNCATE`）, `width?`, `height?` |

### 5.6 自动布局

| op | 参数 |
|---|---|
| `set-auto-layout` | `id`, `mode`（`horizontal`\|`vertical`\|`none`）, `spacing?`, `padding?`, `primaryAxisSizingMode?`（`FIXED`\|`AUTO`）, `counterAxisSizingMode?`（`FIXED`\|`AUTO`） |
| `set-padding` | `id`, `all` 或 `top`/`right`/`bottom`/`left` 或 `horizontal`/`vertical` |
| `set-item-spacing` | `id`, `spacing` |
| `set-primary-axis-align` | `id`, `align`（`MIN`\|`CENTER`\|`MAX`\|`SPACE_BETWEEN`） |
| `set-counter-axis-align` | `id`, `align`（`MIN`\|`CENTER`\|`MAX`\|`BASELINE`） |
| `set-layout-sizing` | `id`, `horizontal?`, `vertical?`（`FIXED`\|`HUG`\|`FILL`） |

### 5.7 组件

| op | 参数 |
|---|---|
| `create-component` | `id`\|`nodeId`\|`from`, `name?` — 把已有节点转成 COMPONENT（**源节点被消费**，返回新节点 id） |
| `create-instance` | `componentId`, `x?`, `y?`, `parentId?` |

---

## 6. 效果对象：`set-effects`（曾有 P0 事故，务必照抄）

三种调用形态：`shadow` 简写 / `effects` 数组 / `blur` 简写。

```jsonc
// 毛玻璃卡：背景模糊 + 描边 + 半透明填色 + 投影
POST /v1/batch
{ "steps": [
  { "op": "create-rect", "params": { "name":"玻璃卡","width":320,"height":180,"fill":{"hex":"#FFFFFF","opacity":0.18},"cornerRadius":16 }, "as":"card" },
  { "op": "set-stroke",  "params": { "id":"$card","color":{"hex":"#FFFFFF","opacity":0.35},"width":1 } },
  { "op": "set-effects", "params": { "id":"$card","effects":[
      { "type":"BACKGROUND_BLUR", "radius":24 },
      { "type":"DROP_SHADOW", "color":"#0B1220", "opacity":0.12, "x":0, "y":8, "blur":24, "spread":0 }
  ] } }
] }
```

**字段形状按效果类型严格区分**——Figma 对效果对象做严格校验，多一个未知字段就整条赋值抛错：

| 类型 | 允许字段 |
|---|---|
| `DROP_SHADOW` / `INNER_SHADOW` | `type`, `color`, `offset`, `radius`, `spread`, `visible`, `blendMode` |
| `LAYER_BLUR` / `BACKGROUND_BLUR` | `type`, `radius`, `visible` —— **不能有 `color`** |

模糊类多写 `color` 会得到：`Unrecognized key(s) in object: 'color'`。这是 §0 提到的 P0 事故根因。

数组形态的简写字段：投影用 `x` / `y` / `blur`（=半径）/ `spread` / `color` / `opacity`；模糊用 `blur`（或 `radius`）。

`blur` 简写 = 单独一个 `LAYER_BLUR`：`{"id":"x","blur":8}`。`shadow` 简写 = 单独一个 `DROP_SHADOW`：`{"id":"x","shadow":{"color":"#000000","opacity":0.08,"y":1,"blur":2}}`。清空：`{"id":"x","clear":true}`。

> **毛玻璃的完整条件**：`BACKGROUND_BLUR` 只对**自身有（半）透明填充**的节点生效。顺序必须是「先 `set-fill` 半透明 → 再 `set-effects`」，否则看不见任何玻璃感。

---

## 7. 别把 op 名写错

`execute()` 在收到未知 op 时会把**全部合法 op 名**回显在错误信息里。如果确实记不准，最省事的做法是故意发一个错误 op，直接从回包读清单——或者读本文件。

# design-intelligence.md — L1 完整转换规则

本文件是 Prompt → Brief 的**确定性规则手册**。Agent 的自由度被限制在：规则命中时照抄，规则未覆盖时走缺省 + 标注 `_assumptions`。

## ① 关键词识别 → 风格路由

| 优先级 | 命中词（任一） | Style Preset |
|---|---|---|
| 1（最高） | 大屏 / IOC / 驾驶舱 / 指挥中心 / 数字孪生 / 可视化大屏 / 智慧城市 | `gov-digital-screen` |
| 2 | 后台 / 管理 / admin / 中后台 / 运营平台 / CRM / ERP | `enterprise-dashboard` |
| 3 | SaaS / 现代 / 极简 / 高级感 / premium / 现代简约 | `premium-saas` |
| 缺省 | 无命中 | `enterprise-dashboard` + assumption |

判定规则：
- 多词命中取**优先级最高**者（"高速公路智慧养护大屏"虽含"养护管理"语义，但"大屏"优先级 1 命中）。
- "网站 / 官网 / landing" 不在首批三套 Preset 内 → 缺省处理 + assumption（后续扩展 web-style preset）。
- 移动 App 判定：含 "App / 小程序 / 移动端" → platform=mobile-app，风格仍按上述路由（通常 premium-saas 或行业缺省）。

## ② 平台判定

| 命中词 | platform | layoutPattern 缺省 |
|---|---|---|
| 后台 / admin / 管理平台 | web-admin | sidebar-content |
| App / 小程序 / 移动端 | mobile-app | tab-flow |
| 大屏 / IOC / 驾驶舱 | big-screen | full-bleed-screen |
| 官网 / website | web-site | top-nav-content |

## ③ 行业映射表

| 行业 | 命中词 | primaryColor | visualSystem 修正 | 组件追加（P1） |
|---|---|---|---|---|
| 教育 | 教育/学校/考试/培训/教务 | #5A5CF0 | 沿用 Preset | ExamCard、ScoreBadge、CourseTable、QuestionBank |
| 医疗 | 医疗/医院/患者/问诊/健康 | #0FB5AE | 圆角+2（更柔和）、辅助色 #00B578 | PatientCard、AppointmentPicker、ReportView、VitalChart |
| 政务 | 政务/审批/公文/一网通办 | #1E5EFF | 圆角-2（更方正）、点缀 #C7000B | ApprovalFlow、DocumentViewer、NoticeBoard |
| 交通 | 交通/高速/养护/路况/物流 | #00D4FF（大屏）/ #2B6DE5（后台） | 大屏底色 #0A1A3C | RoadStatusMap、DeviceMonitor、AlertPanel、TrendChart |
| 金融 | 金融/银行/支付/风控/证券 | #1A1A2E 底 + #D4AF37 点缀 | 高对比、衬线标题可选 | AccountCard、TransactionList、RiskIndicator |
| 美业 | 美发/美容/美甲/造型 | #E8A0BF 或品牌色 | 暖调、大图占比高 | StyleGallery、BookingFlow、BeforeAfterCompare |
| 电商 | 电商/商城/商品/订单 | 品牌色为主 | — | ProductCard、CartDrawer、OrderTracker |
| 通用 | 无命中 | 沿用 Preset | — | 无追加 |

## ④ 信息架构生成模板

**web-admin**：登录 → 工作台(Dashboard) → 核心实体列表×1-3 → 实体详情 → 系统设置。密度 `dense`。
**mobile-app**：首页 → 核心功能页×2-3 → 详情/结果页 → 我的。密度 `balanced`。
**big-screen**：主驾驶舱（全量 KPI+地图+趋势）→ 子屏×1-3（单主题深化：如养护专题/设备专题）。密度 `dense`。
**web-site**：首页 → 功能/产品页 → 关于。密度 `sparse`。

每页必须写 `purpose`（该页回答用户什么问题）——这是 L4 Critic 检查信息层级的依据。

## ⑤ Token 推导

1. 以 Style Preset 的 `visualSystem` 为基线整体继承；
2. 行业映射仅允许改 `primaryColor`（及交通大屏的 `background`）；
3. 字体族决定规则：后台/大屏 = 系统栈（PingFang SC / Microsoft YaHei + Inter 数字）；premium-saas = Inter 优先；
4. 禁止输出 Preset/映射表中不存在的色值——需要新色 = L2 层的职责，L1 只选不造。

## ⑥ 组件预期清单生成

1. 复制 Preset 的 `coreComponents`（全部 P0）；
2. **平台适配例外**：当 platform 与 Preset 缺省形态不一致时（如 mobile-app 配 premium-saas），Preset 中不适用的 P0 组件（如 HeroSection/PricingCard）排除出清单，并在 `_assumptions` 标注；被排除的 P0 不得静默丢弃；
3. 追加行业映射表的组件（P1）；
4. 从用户 Prompt 提取显式提及的功能名词映射为组件（P1；明确核心可 P0）；
5. 上限 20 项，超出按优先级截断。

## ⑦ _assumptions 标注规则

以下情况必须写 `_assumptions`：
- 产品名未提供 → 生成的占位名
- 风格路由走缺省
- 行业未命中映射表
- 页面清单为推导值而用户未列明
禁止把规则命中的判断写进 assumptions（会污染审计）。

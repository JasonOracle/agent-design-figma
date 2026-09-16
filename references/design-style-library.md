# design-style-library.md — Style Preset 手册

四套 Preset。JSON 正本在 `assets/style-library/`，本文件是设计意图与适用边界的说明。**Preset 是 L1 的一切推导基线，修改 Preset = 修改 Skill 本身，需走版本变更。**

> 字体统一约定：Preset 的 `typography` 写的是**降级链**，不是单一族名。Windows 的 Figma 没有 PingFang SC / SF Pro，`loadFontAsync` 会直接抛错。L3 必须按链依次探测，首个成功者胜出，并把实际生效的字体回填 build log（见 `bridge-ops.md` §4.2）。

## A. premium-saas

对标：Apple / Stripe / Linear / Vercel。

- **设计意图**：克制的高级感。信息密度被主动压低，留白本身是设计元素；黑白灰承担 95% 界面，品牌色只出现在关键动作与数据强调上。
- **大留白**：区块间距 ≥48px，页面水平 padding ≥80px。
- **高信息密度控制**：单屏主信息 ≤1 个焦点；列表行高 ≥56px。
- **微阴影**：`0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)`，永不使用高斯大投影。
- **Radius 4–8px**；**黑白灰 + 品牌色**：文本三级灰阶（#111827/#6B7280/#9CA3AF），品牌色默认 #5A5CF0（可换）。
- **字体**：Inter / SF Pro 类无衬线，字阶跨度大（11–26px），标题用 medium 而非 bold。
- **适用**：订阅制 SaaS、开发者工具、现代官网。
- **禁用**：渐变、重投影、拟物、密集表格（需要密集表格请改用 enterprise-dashboard）。

## B. enterprise-dashboard

对标：Element Plus / Ant Design Pro。

- **设计意图**：效率优先的中后台范式。结构可预测（侧边导航 + 面包屑 + 内容区），组件为数据服务。
- **表格**：Header 40 / Row 44，斑马纹可选，操作列文字链。
- **KPI 卡**：四列网格，数值 26px + 标签 12px + 环比指标。
- **数据卡片**：白底 surface + 1px stroke + 4px radius，卡片内 16px padding。
- **深浅双模式**：以浅色为缺省（page #F2F3F5 / surface #FFFFFF），dark token 独立维护不混用。
- **Radius 2/4/6**；主色 #5A5CF0（本仓库 Stage 9 已验证的完整 token 表即此 Preset 的实现）。
- **适用**：教育/医疗/政务/交通的 web-admin 场景。
- **禁用**：营销式大图、超圆角（>8px）、情绪化插画。

## C. gov-digital-screen

对标：智慧城市 IOC / 高速指挥中心 / 数字孪生驾驶舱。

- **设计意图**：3–10 米观看距离的指挥大屏。数据即装饰，一切服务于「远可辨状态、近可查明细」。
- **深蓝背景**：#0A1A3C 基底 + #0F2547 面板，panel 透明度渐层可选（仅数据面板，禁玻璃拟态卡片）。
- **Cyan glow**：数据高亮 #00D4FF，发光仅用于关键指标与地图热区（`0 0 8px rgba(0,212,255,0.6)`），禁止全面滥用。
- **数据可视化**：图表占比 ≥50%；折线/面积图为主，色板 #00D4FF/#3D7EFF/#2EE6A6/#FFB547/#FF5C5C。
- **大屏布局**：full-bleed 三段式（顶栏标题带 8% / 左右面板各 25% / 中央地图 42%+）或 2×3 KPI 网格；基准 1920×1080，按 3840×2160 出 2x。
- **字体**：标题用 DIN/带科技感数字字体（数字等宽），正文系统栈；最小字号 14px（远距可读）。
- **适用**：交通/政务/能源/园区的监控与指挥场景。
- **禁用**：纯白大面积区块、浅色主题、营销文案、动效堆砌（单屏动效 ≤2 处）。

## D. web-marketing

对标：Apple 产品页 / Stripe 首页 / Linear 首页 / Notion 首页。

- **设计意图**：单页讲完一件事，靠**节奏**而不是信息量取胜。纵向区块流（Hero → 价值主张 → 功能 → 社会证明 → CTA → 页脚），每个区块只承担一个叙事任务。
- **色彩**：墨色（#111827）打底 + **单一品牌色**承重。品牌色允许大面积使用（Hero 底色、色带、CTA），但全站只用一个品牌色；其余交给黑白灰与大图。用户给了品牌色就整体替换 `primaryColor`。
- **大留白与纵向节奏**：区块垂直间距 96–160px；内容最大宽度 1200px；桌面水平 padding ≥64px、移动 ≥24px。**层级靠字号与留白，不靠投影。**
- **字阶跨度大**：Hero 56–72px、区标题 28–36px、正文 16–18px。Hero 可用 medium–semibold，正文一律 regular。
- **Radius 8/12/16**（Hero 图与大卡可 20–24 作例外，须在 DS Spec 里显式声明）。
- **图片占位**：营销页是唯一大量用图的 Preset。走 `bridge-ops.md` 的 `toPaint` 半透明填充 + 矢量占位块，**不要**伪造图片。
- **适用**：品牌官网、产品落地页、活动页、发布页。
- **禁用**：侧边导航、后台式密集信息、数据表格、系统原生控件感、等权模块平铺（无层级）、多品牌色混用、自动轮播、弹窗抢注意力。
- **与 premium-saas 的分界**：`premium-saas` 服务**订阅制产品界面**（含登录/定价/工作台，密度 sparse 但仍是"用产品"）；`web-marketing` 服务**营销叙事页**（无工作台、无表单后台、只有转化路径）。同一个项目两者并存时按网页分别推导，不要混成一个 Brief。

## Preset JSON 结构约定

见 `assets/style-library/*.json`，字段：`id / name / keywords / reference / avoid / visualSystem{colorMood, primaryColor, background, surface, textColors[], chartColors[], typography, spacing, radius, shadow} / layoutPattern / contentDensity / coreComponents[{name,type}]`。`coreComponents` 即 L1 组件预期清单的 P0 种子。

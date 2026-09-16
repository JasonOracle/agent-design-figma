# design-style-library.md — Style Preset 手册

三套首批 Preset。JSON 正本在 `assets/style-library/`，本文件是设计意图与适用边界的说明。**Preset 是 L1 的一切推导基线，修改 Preset = 修改 Skill 本身，需走版本变更。**

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

## Preset JSON 结构约定

见 `assets/style-library/*.json`，字段：`id / name / keywords / reference / avoid / visualSystem{colorMood, primaryColor, background, surface, textColors[], chartColors[], typography, spacing, radius, shadow} / layoutPattern / contentDensity / coreComponents[{name,type}]`。`coreComponents` 即 L1 组件预期清单的 P0 种子。

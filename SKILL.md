---
name: ai-design-daily
description: Generate a Chinese AI design daily report from real X/Twitter posts in the last 24 hours. Use when user asks for AI日报/设计日报/AI自媒体日报 with links, ranked sections, and design-focused (about 70%) coverage. Prefer Camofox-based collection (cost-saving), with grok-search as optional fallback.
---

# AI设计日报 Skill

自动追踪指定 bloggers 的 X/Twitter 内容，生成设计相关日报并发送到 Teams。

---

## 快速使用

### 生成并发送日报
```bash
TEAMS_WEBHOOK_URL=<url> node scripts/send_to_teams.mjs --hours 24
```

> 若未设置环境变量，脚本会回退读取 `skills/ai_design_daily/.teams-webhook`。

### 测试卡片格式（使用模拟数据）
```bash
TEAMS_WEBHOOK_URL=<url> node scripts/test_card.mjs
```

### 仅生成 Markdown（控制台输出）
```bash
node scripts/generate_report.mjs --hours 24
```

### 增量详情拉取（推荐）
先由 Camofox 采集候选 status URL/ID：
1. 将 URL（每行一条）写入 `cache/camofox-urls.txt`，或写成 JSON 行（含 `url`、可选 `created_timestamp`）
2. 运行转换脚本生成增量 id 文件：
```bash
node scripts/collect_ids_camofox.mjs --input cache/camofox-urls.txt --output cache/camofox-latest-ids.json --hours 48
```
3. 生成日报：
```bash
node scripts/generate_report.mjs --hours 24 --ids-file cache/camofox-latest-ids.json
```
说明：增量详情会通过 `api.fxtwitter.com/status/:id` 获取。
如需无 ids 文件时强制尝试 fxtwitter 用户发现，可加 `--discover-fallback`（不推荐，稳定性取决于环境）。

---

## 文件结构

```
ai_design_daily/
├── SKILL.md              # 本文档
├── config.json           # 配置（标题、slogan、章节）
├── scripts/
│   ├── send_to_teams.mjs # 完整发送脚本
│   ├── test_card.mjs     # 快速测试脚本
│   └── generate_report.mjs # Markdown 生成
└── references/
    └── query-presets.json # bloggers 列表
```

---

## 日报格式

```
2026年02月28日
AI设计日报Beta（TAI-IPX x 🦞）
追踪过去24小时AI前沿热点事件

🔥 头条热点（Top 5）
━━━━━━━━━━━━━━━━
1. [产品名 + 动作] — [一句话定位]
   [100-140字深度总结]
   👉 [点击查看](URL)

📈 热门话题榜（Top 5）
━━━━━━━━━━━━━━━━
...

🗣️ AI自媒体声音（Top 5）
━━━━━━━━━━━━━━━━
1. @handle（昵称）— [一句话定位]
   [当天核心观点和影响]
   👉 [点击查看](URL)

🧭 小结与展望
━━━━━━━━━━━━━━━━
短期趋势：
• [趋势1]
• [趋势2]
• [趋势3]

持续关注：
• [关注点1]
• [关注点2]
• [关注点3]
```

---

## 内容质量标准（必遵循）

> 用户硬性要求（不可退化）：每日11:00发送版本必须是“100-140字深度摘要 + 设计师视角”的正式版。

## 不可退化规则（硬性）

### 1) 数据与采集
- 主通道：Camofox 增量采集
- 详情拉取：`api.fxtwitter.com/status/:id`
- 禁止在无说明情况下切回“纯摘要截断”模式

### 2) 固定章节结构
必须包含且仅包含以下四段：
- 🔥 头条热点（Top 5）
- 📈 热门话题榜（Top 5）
- 🗣️ AI自媒体声音（Top 5）
- 🧭 小结与展望

### 3) 单条内容格式（强制）
每条必须包含：
1. 产品/事件 + 一句话定位
2. 100-140字深度摘要
3. 设计师视角洞察
4. 可点击链接（`👉 [点击查看](URL)`）

### 4) 自媒体声音定义（强制）
- 写“当天核心观点和影响”
- 禁止写成单纯人物介绍

### 5) 小结与展望（强制）
- 短期趋势：3条
- 持续关注：3条

## CARD 样式验收清单（发送前）

发送前必须全部通过：
- [ ] 单张 Adaptive Card（不拆分）
- [ ] 顶部顺序：日期 → 标题（`AI设计日报Beta（TAI-IPX x 🦞）`）→ slogan（`追踪过去24小时AI前沿热点事件`，无句号）
- [ ] 四个章节标题均为 emoji 标题，且每章有分割线（separator）
- [ ] 每条为三行结构：标题行（加粗）+ 摘要行 + 链接行
- [ ] 链接为可点击 markdown，不是裸 URL（`👉 [点击查看](URL)`）
- [ ] 禁止退化为“整段大文本 TextBlock”

若任一项不通过：本次任务标记失败并停止发送，并通过 OpenClaw 向用户回报失败原因。

### 合格 CARD 基线（回归样例）

以下 JSON 片段可作为“样式回归”最低基线（字段可替换，结构不可改）：

```json
{
  "type": "AdaptiveCard",
  "version": "1.5",
  "body": [
    {"type":"TextBlock","text":"2026年03月03日"},
    {"type":"TextBlock","text":"AI设计日报Beta（TAI-IPX x 🦞）","weight":"Bolder","size":"Large"},
    {"type":"TextBlock","text":"追踪过去24小时AI前沿热点事件"},

    {"type":"TextBlock","text":"🔥 头条热点（Top 5）","weight":"Bolder","size":"Medium","separator":true},
    {"type":"TextBlock","text":"📈 热门话题榜（Top 5）","weight":"Bolder","size":"Medium","separator":true},
    {"type":"TextBlock","text":"🗣️ AI自媒体声音（Top 5）","weight":"Bolder","size":"Medium","separator":true},
    {"type":"TextBlock","text":"1. 标题","weight":"Bolder"},
    {"type":"TextBlock","text":"100-140字摘要（含设计师视角）"},
    {"type":"TextBlock","text":"👉 [点击查看](https://x.com/.../status/...)"}
  ]
}
```

回归检查时，至少确认：
- 顶部三行顺序不变
- 四章节都有且带 separator
- 每条都严格三行结构
- 链接均为 `👉 [点击查看](URL)`

---

## 高质量日报基线模板（2026-03-03 验收通过）

以下内容经用户验收通过，作为生成日报的参考基线：

### 头条热点示例

```
1. OpenClaw GitHub 星标超越 React
个人 AI 助手项目 OpenClaw 在 GitHub 上的星标数正式超过 React。一个由奥地利龙虾爱好者打造的 AI 助手，超越了支撑半个互联网的前端框架。当天发布了 90 多项更新，显示出开源社区的强劲活力，也预示着 AI 助手正在成为开发者的新基础设施。
👉 [点击查看](https://x.com/openclaw/status/2028347703621464481)

2. Figma 迎来 Auto Layout 大月
Figma 官方回顾了被称为 Auto Layout 月的产品迭代周期。Auto Layout 作为设计系统的核心能力，其持续优化直接影响设计师的组件化效率与响应式设计工作流。设计师需要关注这些基础能力的演进，它们决定了设计系统与工程实现的协作成本。
👉 [点击查看](https://x.com/figma/status/2028621019699970291)

3. Tabbit 发布：光年之外团队推出 AI 浏览器
美团收购的光年之外团队发布 AI 浏览器 Tabbit，支持 Agent 能力和 Skill 扩展。国内版接入国内模型，国际版支持海外模型。AI 浏览器的出现正在重塑信息获取方式，设计师需要思考如何在 Agent 时代重新定义用户界面的信息架构与交互模式。
👉 [点击查看](https://x.com/Gorden_Sun/status/2028656955649351711)
```

### 热门话题榜示例

```
1. OpenClaw 发布 2026.3.1 版本
新版本支持 OpenAI WebSocket 流式传输、Claude 4.6 自适应思考、Docker 和原生 K8s 支持、Discord 线程等功能，并推出 Agent 驱动的可视化差异对比插件。这些更新强化了 OpenClaw 在企业级部署和开发者体验上的竞争力。
👉 [点击查看](https://x.com/openclaw/status/2028337080959426953)

2. 大型项目 Claude Code 配置方案公开
一套用于大型项目的 Claude Code 配置方案在 GitHub 公开，包含代码规范层、19 个专用智能体层、按需加载的子系统规范层。该配置已用于编写 10.8 万行 C# 分布式系统，为 AI 辅助大型项目开发提供了可复用的方法论。
👉 [点击查看](https://x.com/Gorden_Sun/status/2028406705621754083)
```

### AI自媒体声音示例

```
1. @Gorden_Sun — AI工具深度评测与资讯整合
当天发布多条高价值内容，涵盖 Tabbit AI 浏览器深度解读、Claude Code 配置方案推荐、Claude App Store 排名追踪等。其资讯日报已成为中文 AI 圈获取前沿信息的重要信源，内容兼具深度与广度。
👉 [点击查看](https://x.com/Gorden_Sun/status/2028420618572730578)

2. @openclaw — 开源 AI 助手项目官方发声
当天密集发布项目进展，包括 GitHub 星标超越 React、2026.3.1 版本更新、社区贡献里程碑等。其内容展示了开源 AI 项目的透明运营风格，为其他 AI 产品团队提供了社区沟通的参考范式。
👉 [点击查看](https://x.com/openclaw/status/2028347703621464481)
```

### 小结与展望示例

```
短期趋势：
• AI 助手从专业工具向大众消费市场渗透，Claude 登顶 App Store 是重要信号
• AI 浏览器赛道升温，Agent 能力与 Skill 扩展成为产品差异化的关键
• 开源 AI 项目展现强劲生命力，社区驱动迭代成为可行模式

持续关注：
• Claude Code 配置方案能否形成可复制的大型项目开发方法论
• AI 产品在语音交互、流式输出等体验创新上的持续演进
• 开源 AI 助手与商业产品在功能边界与用户体验上的竞争格局
```

**关键特征**：
- 标题是新闻句式（如"OpenClaw GitHub 星标超越 React"），不是拼接式
- 摘要全部中文，无英文原文残留
- 摘要 100-140 字，先说发生了什么，再说影响
- 设计师视角自然融入句尾，不用固定前缀

### 每条内容格式

```
1. [产品/公司名 + 动作，+ 一句话定位]
[100-140字新闻摘要：先说发生了什么，再说关键影响；可自然带出设计相关意义]
👉 [点击查看](URL)
```

### 文风与表达硬规则（新增）

- 标题必须是新闻句式，禁止使用“+ + +”拼接符号
- 摘要必须是新闻摘要语境，读完即可知道“发生了什么事”
- 禁止模板腔：如“该动态强调…/这条信息围绕…”
- 设计相关意义应自然融入句尾，不使用生硬固定前缀（如“设计师为何关心：”）
- 禁止直接贴原帖英文长句；需中文重述关键信息
- 禁止凑字数重复句（如同义句反复出现）

### 示例

```
1. Arrow 1.0 发布 — 专攻 SVG 生成的 AI 模型
@Gorden_Sun 推荐了一款专注生成 SVG 图片的模型，支持文字生成 SVG 和图片转 SVG，生成过程可实时观看 AI 逐线绘制。浏览器直接渲染的特性让设计资源更轻量，但面临 Gemini 后续替代风险。
👉 [点击查看](https://x.com/...)
```

### AI自媒体声音格式

```
序号. @handle（昵称）— 一句话定位
简述当天活跃内容的核心观点和影响（100-140字）
👉 [点击查看](URL)
```

- 默认保持该段既有结构；若用户仅要求修改头条/话题榜，不得擅自改动该段表达风格

### 示例

```
1. @dotey（宝玉）— 深度科技翻译与评论
过去 24 小时连续发布 5 条关于 OpenAI/Anthropic 与美国政府博弈的深度分析，翻译完整声明原文、梳理事件时间线、对比双方立场差异。其内容成为中文圈了解此事件的核心信源，影响范围广。
👉 [点击查看](https://x.com/dotey/status/...)
```

**注意**：自媒体声音不是介绍博主本身，而是简述他们当天的核心观点和影响力。必须有链接。

### 小结与展望格式

```
短期趋势：
• [趋势1]
• [趋势2]
• [趋势3]

持续关注：
• [关注点1]
• [关注点2]
• [关注点3]
```

**注意**：保留"•"符号，每条前加空格

---

## 内容来源

- **主通道（默认）**: Camofox（低成本）
  - 按 `references/query-presets.json` 的 bloggers 白名单逐个抓取最近帖子
  - 建议每账号抓取 30-50 条，时间窗口默认过去 24 小时
  - 做增量去重（按 tweet/status id）
- **兜底通道（可选）**: grok-search
  - 仅在关键账号抓取失败或需要补盲时启用
  - 查询格式：`from:@handle1 OR from:@handle2 OR ...`
- **设计占比**: 70%（通过 designLexicon 判断）
- **时间窗口**: 默认过去 24 小时

### 建议策略（省成本）

1. `source_mode = camofox`（默认）
2. `xai_fallback = false`（默认关闭）
3. 对失败账号记录日志，不阻塞整份日报
4. 持久化最近已处理的 status id，仅做增量抓取

---

## 自动化

### Cron 定时任务（高质量日报自动发送）

**执行流程**：
```
每天 11:00 (Asia/Shanghai) → Cron 触发子代理 → 子代理执行采集+生成+发送
```

**子代理执行指令**：
1. 读取 `cache/camofox-latest-ids.json` 获取候选推文
2. 用 `api.fxtwitter.com/status/:id` 获取每条推文详情
3. 按 SKILL.md 规范生成高质量日报内容：
   - 全部中文重述，禁止英文原文残留
   - 新闻句式标题，禁止拼接符号
   - 每条 100-140 字深度摘要
   - 三个章节各 Top 5
4. 构造 Adaptive Card 并发送到 Teams webhook
5. 发送格式：`{ card }`（不是 message/attachments）

**手动触发**：
告诉主代理"发日报"或"执行AI设计日报"

---

## 已知问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| handles 参数不生效 | grok-search `--handles` 行为异常 | 使用 `from:@handle` query 格式 |
| 分类内容为空 | 筛选条件过严 | 放宽 curatedPool，让 score 排序 |

---

## 安全提醒

- ⚠️ Webhook URL 含签名，需定期轮换
- 🔐 支持多个 webhook：在 `.teams-webhook` 文件中每行放一个 URL，会依次发送到所有地址
- 🚫 勿将 URL 提交到代码仓库

---

## 待优化

- [x] ~~脚本改造：自动调用 AI 生成高质量内容~~ → 改为 Cron 触发子代理执行
- [x] ~~Camofox 采集自动化~~ → 子代理自动访问账号、采集 URL、生成 ids 文件
- [ ] webhook URL 轮换机制
- [ ] 错误重试机制

---

最后更新: 2026-03-03

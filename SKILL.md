---
name: ai-design-daily
description: Generate a Chinese AI design daily report from real X/Twitter posts in the last 24 hours. Use when user asks for AI日报/设计日报/AI自媒体日报. Output: TOP 10 (10 items) + 小结与展望 (one paragraph). Design-focused ~70%. Prefer Camofox-based collection (cost-saving), with grok-search as optional fallback.
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

### OpenClaw 下由 AI 生成日报再发送（推荐）
1. 生成候选 JSON：`node scripts/generate_report.mjs --hours 24 --ids-file cache/camofox-latest-ids.json --candidates-only --output cache/candidates.json`
2. 由子代理根据 SKILL 与 `cache/candidates.json` 用 AI 撰写日报，写入 `cache/generated-report.md`
3. 发送：`node scripts/send_to_teams.mjs --report-file cache/generated-report.md`  
详见下方「自动化 → 子代理执行指令」。

---

## 文件结构

```
ai_design_daily/
├── SKILL.md              # 本文档
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

📌 TOP 10
━━━━━━━━━━━━━━━━
[产品/公司名 + 动作] — [一句话定位]
[100-140字深度总结]
👉 [点击查看](URL)

[产品/公司名 + 动作] — [一句话定位]
…
（共 10 条，无序号）

🧭 小结与展望
━━━━━━━━━━━━━━━━
[一段话总结当天AI整体情绪与趋势，展望可能持续发酵的话题；可侧重对设计/产品形态的短期影响。]
```

---

## 内容质量标准（必遵循）

> 用户硬性要求（不可退化）：每日10:00发送版本必须是“100-140字深度摘要 + 设计师视角”的正式版。

## 用户目标与原则（与 prompt 一致）

- **目标**：在繁杂信息流中过滤噪音，呈现 UI/UX 设计师真正关心的内容；每条内容需体现「核心知识/观点」与「为什么设计师会关心」。
- **选人标准**：入榜内容应因其**观点有见解、有营养、能打开认知**，而非仅因出现频率高。
- **风格**：客观、中立、精炼、专业，简体中文。只呈现事实与热点，不加入主观评价；「设计师视角」指与 UI/UX 工作的联系或设计师关心的理由，不以主观褒贬形式出现。
- **范围**：内容范围为过去 24 小时；设计相关内容约占整体 70%；TOP 10 向设计倾斜。

## 不可退化规则（硬性）

### 1) 数据与采集
- 主通道：Camofox 增量采集
- 详情拉取：`api.fxtwitter.com/status/:id`
- 禁止在无说明情况下切回“纯摘要截断”模式
- **必须完整遍历** `references/query-presets.json` 中 `bloggers` 与 `official` 的每一个账号，不得跳过；某账号失败则记录后继续，最后汇报成功/失败列表。

### 2) 固定章节结构
必须包含且仅包含以下两段：
- **📌 TOP 10**（共 10 条）
- **🧭 小结与展望**（一段话）

### 2.5) TOP 10 去重（禁止重复）
- **同一 URL/同一条推文**：只出现一次，禁止重复入榜。
- **同一主题或同一活动**：如同一场大会、同一产品同一波发布、同一条新闻的不同推文，**只保留一条最具代表性的**，其余从候选中用其他主题补足 10 条。避免出现「第 1 条与第 10 条都是某大会/某活动」这类同主题重复。

### 3) 单条内容格式（强制）
每条必须包含：
1. 产品/公司名 + 动作 + 一句话定位
2. 摘要严格 100–140 字，以新闻导语方式撰写：先写发生了什么事，再写影响或意义；禁止模板腔；禁止摘要以省略号（…/...）结尾，须完整成句；长度严格 ≤140 字
3. 设计师视角自然融入摘要
4. 可点击链接（`👉 [点击查看](URL)`）

## CARD 样式验收清单（发送前）

发送前必须全部通过：
- [ ] 单张 Adaptive Card（不拆分）
- [ ] 顶部顺序：日期 → 标题（`AI设计日报Beta（TAI-IPX x 🦞）`）→ slogan（`追踪过去24小时AI前沿热点事件`）
- [ ] 两个章节：📌 TOP 10、🧭 小结与展望，且每章有分割线（separator）
- [ ] TOP 10 共 10 条，每条为三行结构：标题行（加粗）+ 摘要行 + 链接行
- [ ] 链接为可点击 markdown，不是裸 URL（`👉 [点击查看](URL)`）
- [ ] 禁止退化为“整段大文本 TextBlock”
- [ ] 标题与摘要无英文整句或未翻译长段；存在则不合格，不发送
- [ ] 每条摘要 100–140 字且为完整新闻句；不足、超出或以省略号结尾均不通过
- [ ] 小结与展望为一段话，包含当天情绪/趋势与展望
- [ ] TOP 10 内无同一条推文重复（同一 URL 只出现一次）；无同主题重复（如同一大会、同一活动只保留一条）

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

    {"type":"TextBlock","text":"📌 TOP 10","weight":"Bolder","size":"Medium","separator":true},
    {"type":"TextBlock","text":"标题","weight":"Bolder"},
    {"type":"TextBlock","text":"100-140字摘要（含设计师视角）"},
    {"type":"TextBlock","text":"👉 [点击查看](https://x.com/.../status/...)"},
    {"type":"TextBlock","text":"🧭 小结与展望","weight":"Bolder","size":"Medium","separator":true},
    {"type":"TextBlock","text":"一段话总结当天AI整体情绪与趋势，展望可能持续发酵的话题；可侧重对设计/产品形态的短期影响。"}
  ]
}
```

回归检查时，至少确认：
- 顶部三行顺序不变
- 两章节（TOP 10、小结与展望）都有且带 separator
- TOP 10 每条都严格三行结构
- 链接均为 `👉 [点击查看](URL)`
- 小结与展望为单一段落

---

## 高质量日报基线模板（验收通过）

以下内容作为生成日报的参考基线：

### TOP 10 示例（共 10 条，此处仅列 3 条，无序号）

```
OpenClaw GitHub 星标超越 React
个人 AI 助手项目 OpenClaw 在 GitHub 上的星标数正式超过 React。一个由奥地利龙虾爱好者打造的 AI 助手，超越了支撑半个互联网的前端框架。当天发布了 90 多项更新，显示出开源社区的强劲活力，也预示着 AI 助手正在成为开发者的新基础设施。
👉 [点击查看](https://x.com/openclaw/status/2028347703621464481)

Figma 迎来 Auto Layout 大月
Figma 官方回顾了被称为 Auto Layout 月的产品迭代周期。Auto Layout 作为设计系统的核心能力，其持续优化直接影响设计师的组件化效率与响应式设计工作流。设计师需要关注这些基础能力的演进，它们决定了设计系统与工程实现的协作成本。
👉 [点击查看](https://x.com/figma/status/2028621019699970291)

Tabbit 发布：光年之外团队推出 AI 浏览器
美团收购的光年之外团队发布 AI 浏览器 Tabbit，支持 Agent 能力和 Skill 扩展。国内版接入国内模型，国际版支持海外模型。AI 浏览器的出现正在重塑信息获取方式，设计师需要思考如何在 Agent 时代重新定义用户界面的信息架构与交互模式。
👉 [点击查看](https://x.com/Gorden_Sun/status/2028656955649351711)
```

### 小结与展望示例（一段话）

```
过去 24 小时 AI 圈整体情绪偏积极，开源项目与产品更新密集。短期内 Agent UX、Design-to-Code 与多模态设计协同仍会持续发酵；对设计/产品形态的影响集中在工作流整合与组件化交付效率上，值得持续关注。
```

**关键特征**（详见不可退化规则 3) 与 CARD 验收）：
- 标题：新闻句式、每条独立撰写，禁止多条套用同一句式
- 摘要：全部中文、100–140 字、完整成句、禁止省略号结尾；先说发生什么再说影响，设计师视角自然融入
- 小结与展望：一段话（情绪与趋势 + 持续发酵话题 + 可侧重设计/产品短期影响）

### 文风与表达硬规则

- 禁止模板腔（如「该动态强调…」「这条信息围绕…」）；设计相关意义自然融入句尾，不用固定前缀
- 禁止凑字数重复句；客观、中立、精炼、专业，只呈现事实与热点不加入主观评价

### 红线清单（强制拦截）

以下任一命中，**直接判定不合格并停止发送**：
- 出现“后记/制作说明”类文案（如「本日报由AI自动生成」「来自XX个博主与官方账号」）
- 出现明显主观代入与评论口吻（如「我认为/我觉得/我们认为」「提醒我们」「折腾是乐趣」）
- 出现情绪化夸张词（如「重磅」「炸裂」「令人振奋」「值得期待」）
- 小结与展望不是单段，或以省略号结尾
- TOP 10 任一条摘要出现模板腔、占位句、省略号结尾，或字数不在 100–140

实现要求：
- `scripts/send_to_teams.mjs` 发送前校验必须包含上述红线；命中即 `throw`，本次发送失败。
- 校验失败时，输出可读的失败原因，供主代理直接回报用户。

---

## 内容来源

- **主通道（默认）**: Camofox（低成本）
  - **必须完整遍历** `references/query-presets.json` 中 `bloggers` 与 `official` 列表的每一个账号，按列表顺序逐个访问，不得跳过；若某账号访问失败，记录该账号及原因后继续下一个，最后汇总成功/失败列表
  - 建议每账号抓取 30-50 条，时间窗口默认过去 24 小时
  - 做增量去重（按 tweet/status id）
- **兜底通道（可选）**: grok-search
  - 仅在关键账号抓取失败或需要补盲时启用
  - 查询格式：`from:@handle1 OR from:@handle2 OR ...`
- **设计占比**: 70%（通过 designLexicon 判断）
- **时间窗口**: 默认过去 24 小时

### 建议策略（省成本）

默认使用 Camofox 采集、不启用 grok 兜底；对失败账号记录日志不阻塞整份日报，持久化已处理 status id 做增量抓取。

---

## 自动化

### Cron 定时任务（高质量日报自动发送）

**约束（强制）**：
- **每次触发发送任务 = 全链路重跑**：不得复用前一日或更早的 `cache/camofox-urls.txt`、`cache/camofox-latest-ids.json`、`cache/fxtwitter-state.json` 直接出日报；必须从「采集 → 生成 ID → fxtwitter 拉取详情 → AI 写稿 → `--report-file` 发送」全链路重新执行一遍。
- **采集内容必须完整覆盖来源**：一次采集任务必须尝试访问 `query-presets.json` 中 `bloggers` 与 `official` 的**每一个账号**（逐个访问 profile，不得跳过）；若某账号失败则记录 handle 与原因并继续，最终在汇报中给出「成功/失败账号列表」，在未尝试完整账号列表前不得宣称采集完成。

**采集任务（每天 9:30，仅采集不发送）**：
- 子代理读取 `references/query-presets.json`，**完整遍历**其中 `bloggers` 与 `official` 的每一个账号，使用 Camofox 逐个访问其 Twitter 个人页，滚动采集最近 24 小时内推文 URL，写入 `cache/camofox-urls.txt`，再运行 `collect_ids_camofox.mjs` 生成 `cache/camofox-latest-ids.json`
- **不得跳过任一账号**；失败则记录后继续，最后汇报采集结果（成功/失败账号列表）
- 本任务**不执行**生成日报或发送

**发送任务（每天 10:00）**：
```
Cron 触发子代理 → 子代理：拉取候选 → 用 AI 按 SKILL 生成日报 → 写入文件 → 调用脚本发送
```

**子代理执行指令（必须按顺序执行）**：

1. **拉取候选数据**：在 skill 根目录执行  
   `node scripts/generate_report.mjs --hours 24 --ids-file cache/camofox-latest-ids.json --candidates-only --output cache/candidates.json`  
   得到 `cache/candidates.json`（内含 `reportDate` 与 `candidates` 数组，每项含 `url`、`author`、`snippet` 等）。

2. **阅读规范**：打开本 SKILL.md 与「用户目标与原则」「不可退化规则」「文风与表达硬规则」；若有 `prompt.md` 则一并阅读，作为生成风格与选条依据。

3. **用 AI 生成日报正文**：根据 `candidates` 中的 10 条推文，由你（AI）撰写：
   - **TOP 10**：每条一条**新闻式标题**（产品/事件+动作+一句话定位，禁止套用同一句式）+ **100–140 字中文摘要**（先写发生什么再写影响，设计师视角自然融入，禁止英文整句、禁止模板腔、禁止省略号结尾）+ 该条 `url` 用作链接。每条摘要严格 ≤140 字且完整成句，不得以「…」结尾；若超长请改写压缩而非截断。
   - **去重**：选条时**同一 URL 只出现一次**；若多条候选属于**同一主题/同一活动**（如同一场大会、同一产品同一波发布），只保留一条最具代表性的，其余从候选中用其他主题补足 10 条，避免第 1 条与第 10 条等同主题重复。
   - **小结与展望**：**一段话**总结当天 AI 整体情绪与趋势、展望可能持续发酵的话题，可侧重设计/产品形态短期影响。

4. **写入日报文件**：将生成的日报按下列 Markdown 格式写入 `cache/generated-report.md`（首行可为日期，便于解析）：
   ```
   YYYY年MM月DD日
   《AI设计日报》

   📌 TOP 10
   [新闻式标题]
   [100-140字中文摘要]
   👉 [点击查看](https://x.com/.../status/...)

   [新闻式标题]
   …
   （共 10 条，无序号）

   🧭 小结与展望
   [一段话]
   ```

5. **发送到 Teams**：执行  
   `node scripts/send_to_teams.mjs --report-file cache/generated-report.md`  
   （webhook 从 `.teams-webhook` 或环境变量读取）。发送前脚本会校验条数、摘要长度与格式，不通过则报错不发送。

**手动触发**：
告诉主代理"发日报"或"执行AI设计日报"，子代理按上述 1～5 步执行。

---

## 已知问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| handles 参数不生效 | grok-search 兜底时 `--handles` 行为异常 | 使用 `from:@handle` query 格式 |
| 分类内容为空 | 筛选条件过严 | 放宽 curatedPool，让 score 排序 |

---

## 安全提醒

- ⚠️ Webhook URL 含签名，需定期轮换
- 🔐 支持多个 webhook：在 `.teams-webhook` 文件中每行放一个 URL，会依次发送到所有地址
- 🚫 勿将 URL 提交到代码仓库

---

## 待优化

- [ ] webhook URL 轮换机制
- [ ] 错误重试机制

---

最后更新: 2026-03-04

---
name: ai-design-daily
description: Generate a Chinese AI design daily report from real X/Twitter posts in the last 24 hours. Use when user asks for AI日报/设计日报/AI自媒体日报. Output: TOP 10 (10 items) + 小结与展望 (one paragraph). Design-focused ~70%. Collection requires camofox-browser server (REST API). Run `npm run strict` for the full pipeline.
---

# AI设计日报 Skill

自动追踪指定 bloggers 的 X/Twitter 内容，生成设计相关日报并发送到 Teams。

---

## 快速使用

### 正式完整跑（推荐，单入口）
```bash
npm run strict
```

`npm run strict` 会自动完成：实时采集 → URL→ID → 账号覆盖校验 → 候选生成。
运行后如缺少 `cache/generated-report.md`，会报错提示子代理需先写稿。

> Webhook 配置：`TEAMS_WEBHOOK_URL` 环境变量，或 `.teams-webhook` 文件（每行一个 URL）。

### 测试卡片格式（模拟数据）
```bash
TEAMS_WEBHOOK_URL=<url> node scripts/test_card.mjs
```

### 底层脚本（高级 / 调试用）

| 命令 | 说明 |
|------|------|
| `npm run collect:camofox` | 仅采集（camofox-browser REST API），产出 `cache/camofox-urls.txt` |
| `npm run collect:ids` | URL→ID 转换 |
| `npm run attempts` | 生成账号覆盖报告 |
| `npm run generate` | 候选生成 / Markdown 输出 |
| `npm run send` | 发送到 Teams |

正式流程请始终使用 `npm run strict`，上述底层脚本仅供调试或单步排查。

### 采集层（camofox-browser，必需）

| 依赖 | 说明 |
|------|------|
| `CAMOFOX_URL` 环境变量 | camofox-browser 服务地址（默认自动读取 OpenClaw 插件配置，否则回退 `http://localhost:9377`） |
| `CAMOFOX_API_KEY` 环境变量 | 可选，用于需要鉴权的端点 |
| 有效的 X/Twitter cookies | **必需**；否则会落入 X 登录墙，无法抓到 timeline |

采集脚本 `collect_camofox.mjs` 通过 camofox-browser REST API 逐个访问 Twitter profile，滚动提取推文时间线。
零额外 npm 依赖（使用 Node 原生 `fetch`）。**无 camofox-browser 时脚本会直接报错退出**。
若页面命中 `Log in / Sign up / New to X? / Don’t miss what’s happening` 且 timeline 结构计数为 0，脚本会直接判定为 **`X guest/login wall detected — missing or expired X/Twitter cookies`**，而不是再把结果误报成“0 tweets in 24h”。

安装方式：
- **OpenClaw 插件**：`openclaw plugins install camofox-browser`（自动注入环境变量）
- **独立部署**：`npx camofox-browser` 或 Docker `ghcr.io/redf0x1/camofox-browser`

> fxtwitter 仅在**内容补全**阶段有效（按已知 status ID 查单条推文），无法用于发现新推文。

### 内容补全策略（`generate_report.mjs` 内部）

采集后，对缺少正文的条目自动补全：

| Tier | 数据源 | 说明 |
|------|--------|------|
| 1 | Camofox 已有内容 | 直接使用，零请求 |
| 2 | fxtwitter status API | `api.fxtwitter.com/status/:id`，免费 |

可通过 `--no-fxtwitter` 跳过 Tier 2。

---

## 文件结构

```
ai_design_daily/
├── SKILL.md                     # 本文档
├── package.json                 # 工程元信息 & npm scripts & 依赖
├── scripts/
│   ├── lib/
│   │   └── shared.mjs           # 共享工具（CLI 解析、Card 构建、Webhook 封装）
│   ├── collect_camofox.mjs      # ★ 实时采集（camofox-browser REST API）
│   ├── collect_ids_camofox.mjs  # URL → ID 转换 + 时间窗口过滤
│   ├── build_account_attempts.mjs # 账号覆盖统计（按时间窗口）
│   ├── run_strict.mjs           # ★ 单入口全链路执行
│   ├── generate_report.mjs      # 候选生成 + 内容补全（二级策略）
│   ├── send_to_teams.mjs        # 发送到 Teams
│   └── test_card.mjs            # 测试卡片格式
├── references/
│   └── query-presets.json       # bloggers + official 账号列表
└── cache/                       # 运行时缓存（不提交，每次 strict 清空重建）
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

> 用户硬性要求（不可退化）：每日10:00发送版本必须是"100-140字深度摘要 + 设计师视角"的正式版。

## 用户目标与原则（与 prompt 一致）

- **目标**：在繁杂信息流中过滤噪音，呈现 UI/UX 设计师真正关心的内容；每条内容需体现「核心知识/观点」与「为什么设计师会关心」。
- **选人标准**：入榜内容应因其**观点有见解、有营养、能打开认知**，而非仅因出现频率高。
- **风格**：客观、中立、精炼、专业，简体中文。只呈现事实与热点，不加入主观评价；「设计师视角」指与 UI/UX 工作的联系或设计师关心的理由，不以主观褒贬形式出现。
- **范围**：内容范围为过去 24 小时；设计相关内容约占整体 70%；TOP 10 向设计倾斜。

## 不可退化规则（硬性）

### 1) 数据与采集
- **采集由 `collect_camofox.mjs` 自动完成**（camofox-browser REST API，必需），`npm run strict` 会自动调用
- 内容补全二级策略：Camofox 已有内容 → fxtwitter status API
- **禁止复用旧缓存**：每次触发 strict 必须清空全部 `cache/` 运行产物并重新采集
- 禁止在无说明情况下切回"纯摘要截断"模式
- **必须完整遍历** `references/query-presets.json` 中 `bloggers` 与 `official` 的每一个账号，不得跳过；某账号失败则记录后继续，最后汇报成功/失败列表
- **必须检测 cookie / 登录态有效性**：若命中 X 登录墙并且 timeline 结构为空，必须明确报 `X guest/login wall detected — missing or expired X/Twitter cookies`，不得再模糊汇报成普通的 0 条结果

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

### 红线清单（强制）
发送前脚本会逐项校验，**任一项命中即视为不合格，不发送并报错**：
- TOP 10 条数必须为 10，少一条或多一条均不通过
- 每条摘要 100–140 字（按字符计），不足或超出均不通过
- 每条摘要不得以省略号（…、...、．）结尾，须完整成句
- TOP 10 内不得出现重复 URL（同一 status 只允许出现一次）
- 小结与展望必须存在且为非空一段话
- 不得为占位/模板摘要（如「该帖在过去…小时内获得较高讨论度」等）

## CARD 样式验收清单（发送前）

发送前必须全部通过：
- [ ] 单张 Adaptive Card（不拆分）
- [ ] 顶部顺序：日期 → 标题（`AI设计日报Beta（TAI-IPX x 🦞）`）→ slogan（`追踪过去24小时AI前沿热点事件`）
- [ ] 两个章节：📌 TOP 10、🧭 小结与展望，且每章有分割线（separator）
- [ ] TOP 10 共 10 条，每条为三行结构：标题行（加粗）+ 摘要行 + 链接行
- [ ] 链接为可点击 markdown，不是裸 URL（`👉 [点击查看](URL)`）
- [ ] 禁止退化为"整段大文本 TextBlock"
- [ ] 标题与摘要无英文整句或未翻译长段；存在则不合格，不发送
- [ ] 每条摘要 100–140 字且为完整新闻句；不足、超出或以省略号结尾均不通过
- [ ] 小结与展望为一段话，包含当天情绪/趋势与展望
- [ ] TOP 10 内无同一条推文重复（同一 URL 只出现一次）；无同主题重复（如同一大会、同一活动只保留一条）

若任一项不通过：本次任务标记失败并停止发送，并通过 OpenClaw 向用户回报失败原因。

### 合格 CARD 基线（回归样例）

以下 JSON 片段可作为"样式回归"最低基线（字段可替换，结构不可改）：

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

---

## 内容来源（内容补全策略）

`generate_report.mjs` 对采集到的条目做三级内容补全：

```
Tier 1: Camofox 内容 ──► 采集时已带 text 的条目直接使用（零成本）
                  │
                  ▼ 缺 text 的
Tier 2: fxtwitter ────► api.fxtwitter.com/status/:id（免费、无认证）
```

### Tier 2: fxtwitter（补全通道）
- 对缺内容（`snippet` 为空）的条目，自动调用 `api.fxtwitter.com/status/:id`
- 免费、无需认证；5 路并发 + 自动重试
- 可通过 `--no-fxtwitter` 跳过

### 通用规则
- **设计占比**: 70%（通过 designLexicon 判断）
- **时间窗口**: 默认过去 24 小时

---

## 严格单入口执行（默认且强制）

使用 `npm run strict`（即 `scripts/run_strict.mjs`）作为唯一正式入口，固定执行：

```
1) 清空全部运行缓存（包括 camofox-urls.txt，强制重采）
       ↓
2) 实时采集所有账号（collect_camofox.mjs: camofox-browser REST API）
       ↓
3) URL → ID 转换（collect_ids_camofox.mjs --hours 24）
       ↓
4) 账号覆盖统计 + 校验（build_account_attempts.mjs --hours 24）
       ↓
5) 生成候选（generate_report.mjs --candidates-only）
       ↓
6) 检查 generated-report.md 存在（AI 写稿，由子代理完成）
       ↓
7) 发送到 Teams（send_to_teams.mjs --report-file）
```

命令：

```bash
npm run strict
```

默认发送模式：`TEAMS_PAYLOAD_MODE=card`。

### 默认策略（重要）

只要触发「AI设计日报生成/发送/正式完整跑」相关请求，默认执行严格单入口流程；
不得跳过步骤、不得直接调用旧的散装命令链替代。

**禁止作为默认路径**：
- 跳过采集，直接复用旧 `cache/camofox-urls.txt`
- 直接 `generate_report.mjs` 输出 Markdown 后发送
- 跳过 `account-attempts.json` 生成与覆盖校验
- 复用前一次 `generated-report.md` 或 `candidates.json` 直接发送

如确需偏离严格流程，必须由用户明确指定并确认。

---

## 自动化

### Cron 定时任务（高质量日报自动发送）

**约束（强制）**：
- **每次触发 = 全链路重跑**：`npm run strict` 会先清空 cache 再实时采集，不得复用任何旧缓存
- **采集内容必须完整覆盖来源**：`collect_camofox.mjs` 会完整遍历 `query-presets.json` 中所有账号；某账号失败记录后继续，最终输出成功/失败/空账号列表

**发送任务（每天 10:00 工作日）**：

```
Cron 触发子代理 → npm run strict（步骤 1-5 自动完成）
                → 子代理读 candidates.json + SKILL.md，AI 写稿
                → 写入 cache/generated-report.md
                → npm run strict 继续步骤 6-7（发送）
```

**子代理执行指令（必须按顺序执行）**：

1. **执行 strict 前半段**：在 skill 根目录执行 `npm run strict`。
   脚本会自动完成采集→ID→覆盖校验→候选生成，然后在步骤 6 报错 `missing generated-report.md`（这是预期行为）。

2. **阅读规范**：打开本 SKILL.md 与「用户目标与原则」「不可退化规则」「文风与表达硬规则」；若有 `prompt.md` 则一并阅读，作为生成风格与选条依据。

3. **用 AI 生成日报正文**：根据 `cache/candidates.json` 中的 10 条推文，由你（AI）撰写：
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

**Cron 配置示例**：

```json
{
  "name": "AI设计日报",
  "schedule": { "kind": "cron", "expr": "0 10 * * 1-5", "tz": "Asia/Shanghai" },
  "payload": {
    "kind": "agentTurn",
    "message": "执行AI设计日报：先运行 npm run strict（会自动采集+生成候选），然后读 SKILL.md 和 cache/candidates.json 用 AI 写日报，写入 cache/generated-report.md，最后运行 node scripts/send_to_teams.mjs --report-file cache/generated-report.md 发送。",
    "timeoutSeconds": 1800
  }
}
```

---

## 已知问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| handles 参数不生效 | 某些 API 中 `--handles` 行为异常 | 使用 `from:@handle` query 格式 |
| 分类内容为空 | 筛选条件过严 | 放宽 curatedPool，让 score 排序 |

---

## 安全提醒

- ⚠️ Webhook URL 含签名，需定期轮换
- 🔐 支持多个 webhook：在 `.teams-webhook` 文件中每行放一个 URL，会依次发送到所有地址
- 🚫 勿将 URL 提交到代码仓库

---

## 待优化

- [ ] webhook URL 轮换机制
- [x] 错误重试机制（已实现：fxtwitter 指数退避重试 + 并发池）
- [x] 内容补全二级数据源（Camofox → fxtwitter）
- [x] 实时采集内建（collect_camofox.mjs: camofox-browser REST API）

---

最后更新: 2026-03-09

## 内容质量硬规则（强制）

生成 `cache/generated-report.md` 时必须满足：

1. **标题必须中文新闻式**
   - 禁止直接截取英文原文作为标题
   - 禁止标题英文占比过高（可读性优先）

2. **摘要必须是"事实 + 影响"结构（100-140字）**
   - 前半句：说清发生了什么
   - 后半句：说清对设计/产品/协作的影响
   - 禁止模板腔重复句式（如同一开场反复出现）

3. **发送前红线校验**
   - 若命中以下任一项，必须阻断发送：
     - 摘要长度不在 100-140
     - 标题英文占比过高
     - 摘要出现模板化重复句式
     - 重复 URL / 缺失 URL / 条数不为10

4. **可读性优先于"凑数通过"**
   - 不得为了通过长度校验拼接空话
   - 不得用占位句覆盖真实信息


## 设计向入选策略（默认）

- 目标占比：设计向 70%
- 下限：设计向至少 5 条
- 提升条件：若高质量设计向条目 >= 7，则优先提升到 7~8 条
- 若设计向不足 5 条：允许高质量非设计向补位；日报小结不显式强调"设计向不足"，只保留专业趋势总结

说明：
- "高质量设计向"由脚本综合分判定（当前阈值：`_score >= 40`）
- 执行报告会输出：设计向条目数、是否触发提升、是否触发补位

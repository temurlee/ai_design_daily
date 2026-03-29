# AI 设计日报

自动采集 X/Twitter AI 设计资讯，生成高质量日报并发送到 Teams。

## 功能

- 🦊 **Camofox 实时采集**：通过 camofox-browser REST API 自动遍历所有账号并采集推文
- 🤖 **AI 生成日报**：按规范生成中文新闻式标题和 100–140 字摘要
- 📤 **Teams 发送**：Adaptive Card 格式，支持多 Webhook
- ⏰ **单入口全链路**：`npm run strict` 一条命令完成采集→生成→发送

## 依赖

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手框架
- [camofox-browser](https://github.com/redf0x1/camofox-browser) - 反检测浏览器 REST API 服务（OpenClaw 插件或独立部署）
- [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) - 有效的 X/Twitter cookies
- 零额外 npm 依赖（使用 Node 原生 `fetch`）

## 实现逻辑

### 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     OpenClaw 主进程                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Cron / 手动触发                                            │
│        │                                                     │
│        ▼                                                     │
│   npm run strict（子代理执行）                                │
│        │                                                     │
│        ├─ 1) 清空全部 cache                                  │
│        ├─ 2) collect_camofox.mjs（REST API 实时采集）        │
│        ├─ 3) collect_ids_camofox.mjs（URL→ID）               │
│        ├─ 4) build_account_attempts.mjs（覆盖校验）          │
│        ├─ 5) generate_report.mjs（候选生成）                 │
│        ├─ 6) 检查 generated-report.md ← AI 写稿（子代理）   │
│        └─ 7) send_to_teams.mjs（发送）                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 数据流

```
┌──────────┐    ┌──────────────────┐    ┌──────────────────────┐
│ bloggers │───►│ camofox-browser  │───►│ 推文 URL + 正文      │
│ + official│    │ REST API 采集    │    │ cache/camofox-urls.txt│
└──────────┘    └──────────────────┘    └──────────┬───────────┘
                                                   │
                                                   ▼
                                          ┌────────────────┐
                                          │ collect_ids    │
                                          │ URL→ID + 去重  │
                                          └───────┬────────┘
                                                  │
                                                  ▼
                                          ┌────────────────┐
                                          │ 内容补全       │
                                          │ Tier1: 已有text│
                                          │ Tier2: fxtwitter│
                                          └───────┬────────┘
                                                  │
                                                  ▼
                                          ┌────────────────┐
                                          │ AI 生成日报    │
                                          │ TOP 10 + 小结  │
                                          └───────┬────────┘
                                                  │
                                                  ▼
                                          ┌────────────────┐
                                          │ Teams Webhook  │
                                          │ Adaptive Card  │
                                          └────────────────┘
```

### 为什么这样设计？

| 设计决策 | 原因 |
|---------|------|
| `npm run strict` 单入口 | 保证每次触发都是完整全链路，不可能跳步或复用旧缓存 |
| camofox-browser REST API | X/Twitter API 限制多且收费；camofox-browser 提供反检测浏览器 + 语言无关的 HTTP 接口 |
| 二级内容补全 | Camofox 已有内容优先（零成本）→ fxtwitter 补单条（免费） |
| AI 写稿由子代理完成 | 子代理本身就是 LLM，有完整 SKILL.md 上下文，质量最优 |
| Adaptive Card | Teams 原生支持，渲染美观，支持 Markdown 链接 |

### 质量控制

日报生成遵循 `SKILL.md` 中的规范：

- **标题**：新闻句式（如「OpenClaw GitHub 星标超越 React」），禁止拼接符号
- **摘要**：100-140 字，先说发生了什么，再说影响
- **语言**：全部中文重述，禁止英文原文残留
- **视角**：设计师视角自然融入句尾，不用固定前缀

## 快速开始

### 1. 安装

将本 skill 复制到 OpenClaw 的 skills 目录：

```bash
cd ~/.openclaw/workspace/skills/
git clone https://github.com/temurlee/ai_design_daily.git
cd ai_design_daily
npm install
```

### 2. 配置 Webhook

创建 `.teams-webhook` 文件：

```bash
echo "YOUR_TEAMS_WEBHOOK_URL" > ~/.openclaw/workspace/skills/ai_design_daily/.teams-webhook
```

支持多个 webhook（每行一个）：

```
https://...webhook1...
https://...webhook2...
```

### 2.1 Power Automate 卡片表达式（避免测试卡弹出）

如果你的 Flow 里用到了 `coalesce(...)`，推荐在 **Post adaptive card** 的卡片输入使用下面表达式：

```powerautomate
coalesce(
  triggerBody()?['card'],
  json('{ "\$schema":"http://adaptivecards.io/schemas/adaptive-card.json", "type":"AdaptiveCard", "version":"1.5", "body":[ {"type":"TextBlock","text":"","isVisible":false} ] }')
)
```

这样在未收到 `card` 字段时会返回"不可见空卡"，不会再出现 *Webhook test / 未收到 card 字段* 的提示卡。

### 3. 配置 Cron 任务

在 OpenClaw 中创建一个 Cron 任务：

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

> `npm run strict` 会自动创建 `cache/` 目录，无需手动创建。

## 目录结构

```
ai_design_daily/
├── SKILL.md                       # 核心文档：指令、模板、规范
├── README.md                      # 本文件
├── package.json                   # 工程元信息 & npm scripts & 依赖
├── .gitignore
├── scripts/
│   ├── lib/
│   │   └── shared.mjs             # 共享工具：CLI 解析、Card 构建、Webhook 封装
│   ├── collect_camofox.mjs        # ★ 实时采集（camofox-browser REST API，必需）
│   ├── collect_ids_camofox.mjs    # URL → ID 转换 + 时间窗口过滤
│   ├── build_account_attempts.mjs # 账号覆盖统计（按时间窗口）
│   ├── run_strict.mjs             # ★ 单入口全链路执行
│   ├── generate_report.mjs        # 候选生成 + 内容补全（二级策略）
│   ├── send_to_teams.mjs          # 发送到 Teams
│   └── test_card.mjs              # 测试卡片格式
├── references/
│   └── query-presets.json         # bloggers + official 账号列表
├── cache/                         # 运行时缓存（不提交，每次 strict 清空重建）
└── .teams-webhook                 # Webhook URL（不提交）
```

## 自定义

### 修改 bloggers 列表

编辑 `references/query-presets.json`：

```json
{
  "bloggers": ["@user1", "@user2", ...],
  "official": ["@figma", "@cursor_ai", ...],
  "designKeywords": ["AI-native UX", "Agent UX", ...],
  "generalKeywords": ["AI", "LLM", ...]
}
```

### 修改日报规范

编辑 `SKILL.md` 中的「高质量日报基线模板」和「文风与表达硬规则」。

## 日报格式

- **TOP 10**：10 条当日重要 AI/设计事件与观点（每条：标题 + 100–140 字摘要 + 链接）
- **小结与展望**：一段话总结当天 AI 整体情绪与趋势，展望可能持续发酵的话题；可侧重对设计/产品形态的短期影响

## 运行约定（重要）

- **每次触发 = 全链路重跑（强制）**：`npm run strict` 会先清空全部 cache 再实时采集，不得复用任何旧缓存
- **采集完整性约束**：`collect_camofox.mjs` 完整遍历 `bloggers` 与 `official` 的每一个账号（不得跳过），输出成功/失败/空账号列表
- **采集必须有 camofox-browser**：服务不可达时脚本直接报错退出（默认自动读取 OpenClaw 插件配置，否则回退 `http://localhost:9377`，也可通过 `CAMOFOX_URL` 覆盖）
- **采集必须有有效 X/Twitter cookies**：若命中 `Log in / Sign up / New to X? / Don’t miss what’s happening` 且 timeline 结构为空，脚本会直接报 `X guest/login wall detected — missing or expired X/Twitter cookies`
- 发送阶段必须显式使用：

```bash
node scripts/send_to_teams.mjs --report-file cache/generated-report.md
```

- 禁止省略 `--report-file` 回退到旧的默认生成链路。

## License

MIT

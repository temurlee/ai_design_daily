# AI 设计日报

自动采集 X/Twitter AI 设计资讯，生成高质量日报并发送到 Teams。

## 功能

- 🦊 **Camofox 采集**：子代理自动访问 bloggers 列表，采集推文 URL 并生成 ID 文件
- 🤖 **AI 生成日报**：按规范生成中文新闻式标题和摘要
- 📤 **多渠道发送**：支持 Teams（Adaptive Card），可扩展其他渠道
- ⏰ **Cron 自动化**：配合 OpenClaw 实现定时执行（采集 9:30，发送 10:00）

## 依赖

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手框架
- [Camofox](https://github.com/redf0x1/camofox-browser) - 反检测浏览器（OpenClaw 内置）

## 实现逻辑

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw 主进程                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   9:30 Cron ──────► 子代理 A（采集任务）                        │
│                          │                                      │
│                          ▼                                      │
│                   ┌─────────────┐                               │
│                   │  Camofox    │                               │
│                   │  浏览器采集  │                               │
│                   └──────┬──────┘                               │
│                          │                                      │
│                          ▼                                      │
│                   camofox-latest-ids.json                       │
│                          │                                      │
│   10:00 Cron ──────► 子代理 B（生成发送）                        │
│                          │                                      │
│                          ▼                                      │
│                   ┌─────────────┐                               │
│                   │  AI 生成    │                               │
│                   │  高质量日报  │                               │
│                   └──────┬──────┘                               │
│                          │                                      │
│                          ▼                                      │
│                   ┌─────────────┐                               │
│                   │  Teams      │                               │
│                   │  Webhook    │                               │
│                   └─────────────┘                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

```
1. 采集阶段（9:30）
   ┌──────────┐    ┌──────────────┐    ┌─────────────────┐
   │ bloggers │───►│ Camofox 访问  │───►│ 推文 URL 列表    │
   │ 列表     │    │ Twitter 账号  │    │ camofox-urls.txt│
   └──────────┘    └──────────────┘    └────────┬────────┘
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │ collect_ids     │
                                      │ 脚本处理        │
                                      └────────┬────────┘
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │ 推文 ID 列表     │
                                      │ latest-ids.json │
                                      └─────────────────┘

2. 生成发送阶段（10:00）
   ┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
   │ latest-ids.json │───►│ fxtwitter API│───►│ 推文详情     │
   └─────────────────┘    │ 获取内容     │    │ (text, etc) │
                          └──────────────┘    └──────┬──────┘
                                                     │
                                                     ▼
                          ┌──────────────────────────────────┐
                          │         AI 生成日报              │
                          │  • TOP 10（10 条）               │
                          │  • 小结与展望（一段话）           │
                          └──────────────┬───────────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────────┐
                          │       Adaptive Card JSON         │
                          └──────────────┬───────────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────────┐
                          │       Teams Webhook(s)           │
                          │       (支持多个频道)              │
                          └──────────────────────────────────┘
```

### 为什么这样设计？

| 设计决策 | 原因 |
|---------|------|
| 分离采集和生成 | 采集确定性高，AI 生成可控性强，便于独立调试 |
| 使用子代理执行 | 隔离环境，避免主会话上下文污染，超时可重试 |
| Camofox 而非 API | X/Twitter API 限制多，Camofox 可访问任意公开内容 |
| fxtwitter API | 免费获取推文详情，无需认证，稳定可靠 |
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

### 3. 创建缓存目录

```bash
mkdir -p ~/.openclaw/workspace/skills/ai_design_daily/cache
```

### 4. 配置 Cron 任务

在 OpenClaw 中创建两个 Cron 任务：

**采集任务（每天 9:30 工作日）**：
```json
{
  "name": "AI日报 Camofox 采集",
  "schedule": { "kind": "cron", "expr": "30 9 * * 1-5", "tz": "Asia/Shanghai" },
  "payload": {
    "kind": "agentTurn",
    "message": "执行AI日报 Camofox 采集：\n\n1. 读取 ~/.openclaw/workspace/skills/ai_design_daily/references/query-presets.json，获取 bloggers 与 official 完整列表\n2. 必须完整遍历上述列表中每一个账号，不得跳过。使用 Camofox 浏览器逐个访问每个账号的 Twitter profile 页面\n3. 滚动页面采集最近 24 小时内的推文，复制每条推文的 status URL\n4. 将所有 URL 写入 ~/.openclaw/workspace/skills/ai_design_daily/cache/camofox-urls.txt\n5. 运行 node ~/.openclaw/workspace/skills/ai_design_daily/scripts/collect_ids_camofox.mjs --input cache/camofox-urls.txt --output cache/camofox-latest-ids.json --hours 48\n6. 汇报采集结果：成功与失败的账号列表",
    "timeoutSeconds": 1800
  }
}
```

**发送任务（每天 10:00 工作日）**：
```json
{
  "name": "AI设计日报自动发送",
  "schedule": { "kind": "cron", "expr": "0 10 * * 1-5", "tz": "Asia/Shanghai" },
  "payload": {
    "kind": "agentTurn",
    "message": "执行AI设计日报生成并发送：\n\n1. 读取 ~/.openclaw/workspace/skills/ai_design_daily/cache/camofox-latest-ids.json\n2. 用 api.fxtwitter.com/status/:id 获取每条推文详情\n3. 按 SKILL.md 规范生成高质量日报（TOP 10 共 10 条 + 小结与展望一段话）\n4. 构造 Adaptive Card 并发送到 Teams webhook\n5. webhook URL 从 .teams-webhook 读取",
    "timeoutSeconds": 600
  }
}
```

## 目录结构

```
ai_design_daily/
├── SKILL.md                    # 核心文档：指令、模板、规范
├── README.md                   # 本文件
├── .gitignore
├── scripts/
│   ├── collect_ids_camofox.mjs # URL 转 ID 脚本
│   ├── send_to_teams.mjs       # 发送到 Teams 脚本
│   ├── generate_report.mjs     # 生成报告脚本
│   └── test_card.mjs           # 测试卡片脚本
├── references/
│   └── query-presets.json      # bloggers 列表
├── cache/                      # 运行时缓存（不提交）
│   ├── camofox-urls.txt
│   └── camofox-latest-ids.json
└── .teams-webhook              # Webhook URL（不提交）
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

## License

MIT
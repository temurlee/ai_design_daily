# AI 设计日报

自动采集 X/Twitter AI 设计资讯，生成高质量日报并发送到 Teams。

## 功能

- 🦊 **Camofox 采集**：自动访问 bloggers 列表，采集最近推文
- 🤖 **AI 生成日报**：按规范生成中文新闻式标题和摘要
- 📤 **多渠道发送**：支持 Teams（Adaptive Card），可扩展其他渠道
- ⏰ **Cron 自动化**：配合 OpenClaw 实现定时执行

## 依赖

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手框架
- Camofox 浏览器插件（OpenClaw 内置）

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

**采集任务（每天 10:00 工作日）**：
```json
{
  "name": "AI日报 Camofox 采集",
  "schedule": { "kind": "cron", "expr": "0 10 * * 1-5", "tz": "Asia/Shanghai" },
  "payload": {
    "kind": "agentTurn",
    "message": "执行AI日报 Camofox 采集：\n\n1. 读取 ~/.openclaw/workspace/skills/ai_design_daily/references/query-presets.json 获取 bloggers 列表\n2. 使用 Camofox 浏览器逐个访问每个 blogger 的 Twitter profile 页面\n3. 滚动页面采集最近 24 小时内的推文，复制每条推文的 status URL\n4. 将所有 URL 写入 ~/.openclaw/workspace/skills/ai_design_daily/cache/camofox-urls.txt\n5. 运行 node ~/.openclaw/workspace/skills/ai_design_daily/scripts/collect_ids_camofox.mjs --input cache/camofox-urls.txt --output cache/camofox-latest-ids.json --hours 48\n6. 汇报采集结果",
    "timeoutSeconds": 1800
  }
}
```

**发送任务（每天 11:00 工作日）**：
```json
{
  "name": "AI设计日报自动发送",
  "schedule": { "kind": "cron", "expr": "0 11 * * 1-5", "tz": "Asia/Shanghai" },
  "payload": {
    "kind": "agentTurn",
    "message": "执行AI设计日报生成并发送：\n\n1. 读取 ~/.openclaw/workspace/skills/ai_design_daily/cache/camofox-latest-ids.json\n2. 用 api.fxtwitter.com/status/:id 获取每条推文详情\n3. 按 SKILL.md 规范生成高质量日报\n4. 构造 Adaptive Card 并发送到 Teams webhook\n5. webhook URL 从 .teams-webhook 读取",
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
├── assets/
│   └── daily-template.md       # 日报模板
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

- **头条热点** Top 5：当日最重要 AI/设计事件
- **热门话题榜** Top 5：热议话题和产品动态
- **AI自媒体声音** Top 5：博主观点整合
- **小结与展望**：短期趋势 + 持续关注

## License

MIT
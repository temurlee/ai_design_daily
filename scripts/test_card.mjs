#!/usr/bin/env node
// Test card generator - uses mock data to verify format
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const webhookUrl = process.env.TEAMS_WEBHOOK_URL || args.find(a => a.startsWith('--webhook='))?.split('=')[1] || '';

const now = new Date();
const reportDate = `${now.getUTCFullYear()}年${String(now.getUTCMonth() + 1).padStart(2, '0')}月${String(now.getUTCDate()).padStart(2, '0')}日`;

// Mock data for list (1～10 条，无 TOP 10 标题)
const top10 = [
  { title: 'Figma 测试 Nano Banana 2', summary: 'Figma 内测 Nano Banana 2，输出更快、支持专业级图像生成，并在 Figma 与 Figma Weave 中逐步开放。设计工具与生成式能力的结合将影响原型与视觉稿的生产效率。', url: 'https://x.com/figma/status/2027158979559014790' },
  { title: 'Codex to Figma 与 OpenAI 打通', summary: 'Codex 与 Figma 实现代码与画布双向同步，接入 OpenAI。设计到代码的闭环有助于降低协作成本，设计师需关注组件与设计系统在此流程中的一致性。', url: 'https://x.com/figma/status/2027068943702364250' },
  { title: 'Cursor Bugbot Autofix 上线', summary: 'Cursor 支持自动修复 PR 中发现的问题。AI 辅助代码审查与修复将改变开发与设计协作的边界，产品可关注其在设计交付与实现一致性上的应用。', url: 'https://x.com/cursor_ai/status/2027079876948484200' },
  { title: 'Tom Krcha 讨论 AI 工作流工具', summary: 'Discord 上展开新一轮 AI 工作流工具讨论。社区对设计-开发工作流工具的期待持续升温，可作为产品方向的参考信号。', url: 'https://x.com/tomkrcha/status/2027086325040697398' },
  { title: 'AI 与有意识的设计思考', summary: 'AI 能快速生成界面，但在有意识的设计思考上仍不足。设计师需在效率与意图之间取得平衡，界面生成工具的价值将取决于是否支持可解释的决策。', url: 'https://x.com/theglobal_lady/status/2026743301957693552' },
  { title: 'OpenClaw 开源进展', summary: '个人 AI 助手项目 OpenClaw 在 GitHub 上持续更新，社区贡献活跃。开源 AI 助手正在成为开发者与设计协作的新基础设施之一。', url: 'https://x.com/openclaw/status/2028347703621464481' },
  { title: 'Design-to-Code 工具动态', summary: '多款 Design-to-Code 工具更新，组件语义与设计系统约束的映射能力增强。设计系统与工程实现的协同成本将进一步下降。', url: 'https://x.com/figma/status/2028621019699970291' },
  { title: 'Agent UX 多模态讨论', summary: 'Agent 与多模态交互的讨论热度上升，从演示可行走向流程可用。设计评估需关注任务成功率与认知负担，而不仅是界面形态。', url: 'https://x.com/Gorden_Sun/status/2028656955649351711' },
  { title: 'Claude Code 配置方案', summary: '大型项目 Claude Code 配置方案在社区流传，包含规范层与智能体层。AI 辅助大型项目开发的方法论正在成型，设计规范的可执行性是关键。', url: 'https://x.com/Gorden_Sun/status/2028406705621754083' },
  { title: 'AI 设计工具工作流整合', summary: 'AI 设计工具竞争从功能堆叠转向工作流整合，谁能缩短从需求到上线的链路谁更有优势。设计师可关注工具在协作与交付闭环上的进展。', url: 'https://x.com/dotey/status/2028420618572730578' }
];

const summaryParagraph = '过去24小时AI圈整体情绪偏积极，开源项目与产品更新密集。短期内 Agent UX、Design-to-Code 与多模态设计协同仍会持续发酵；对设计/产品形态的影响集中在工作流整合与组件化交付效率上，值得持续关注。';

function buildCardItem(item) {
  return [
    { type: 'TextBlock', text: item.title, weight: 'Bolder', wrap: true, spacing: 'Medium' },
    { type: 'TextBlock', text: item.summary, wrap: true, spacing: 'Small' },
    { type: 'TextBlock', text: `👉 [点击查看](${item.url})`, wrap: true, spacing: 'Small', isSubtle: true }
  ];
}

function sectionHeader(emoji, title) {
  return { type: 'TextBlock', text: `${emoji} ${title}`, weight: 'Bolder', size: 'Medium', separator: true, spacing: 'Large' };
}

const card = {
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  type: 'AdaptiveCard',
  version: '1.5',
  body: [
    { type: 'TextBlock', text: reportDate, isSubtle: true, spacing: 'None', wrap: true },
    { type: 'TextBlock', text: 'AI设计日报Beta（TAI-IPX x 🦞）', size: 'Large', weight: 'Bolder', wrap: true },
    { type: 'TextBlock', text: '追踪过去24小时AI前沿热点事件', isSubtle: true, spacing: 'None', wrap: true },
    { type: 'TextBlock', separator: true, spacing: 'Medium' },
    ...top10.flatMap((x) => buildCardItem(x)),
    sectionHeader('🧭', '小结与展望'),
    { type: 'TextBlock', text: summaryParagraph, wrap: true, spacing: 'Medium' }
  ]
};

const payload = { card };

if (dryRun || !webhookUrl) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

// POST to webhook
try {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log(`Status: ${res.status} ${res.statusText}`);
  if (!res.ok) {
    const text = await res.text();
    console.error('Error:', text);
    process.exit(1);
  }
  console.log('✅ Test card sent to Teams');
} catch (e) {
  console.error('Fetch error:', e.message);
  process.exit(1);
}

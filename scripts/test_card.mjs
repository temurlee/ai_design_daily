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

// Mock data from previous report
const top5 = [
  { handle: '@figma', summary: 'Testing Nano Banana 2 in Figma → Faster outputs → Pro-level image generation Rolling out in Figma and Figma Weave', url: 'https://x.com/figma/status/2027158979559014790' },
  { handle: '@figma', summary: 'Codex to Figma - roundtripping between code and canvas with OpenAI', url: 'https://x.com/figma/status/2027068943702364250' },
  { handle: '@cursor_ai', summary: 'Cursor can now automatically fix issues it finds in PRs with Bugbot Autofix', url: 'https://x.com/cursor_ai/status/2027079876948484200' },
  { handle: '@tomkrcha', summary: 'New AI workflow tools discussion on Discord', url: 'https://x.com/tomkrcha/status/2027086325040697398' },
  { handle: '@theglobal_lady', summary: 'AI can generate interfaces quickly. But it still struggles with intentional design thinking', url: 'https://x.com/theglobal_lady/status/2026743301957693552' }
];

function buildCardItem(item, idx) {
  return {
    type: 'Container',
    items: [
      { type: 'TextBlock', text: `${idx + 1}. ${item.handle}`, weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: item.summary, wrap: true, spacing: 'Small' },
      { type: 'TextBlock', text: `原帖：[点击查看](${item.url})`, wrap: true, spacing: 'Small', isSubtle: true }
    ],
    spacing: 'Medium'
  };
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
    { type: 'TextBlock', text: 'AI设计日报Beta（TAI-IPX 试运行）', size: 'Large', weight: 'Bolder', wrap: true },
    { type: 'TextBlock', text: '追踪过去24小时AI前沿热点事件', isSubtle: true, spacing: 'None', wrap: true },
    sectionHeader('🔥', '头条热点（Top 5）'),
    ...top5.map((x, i) => buildCardItem(x, i)),
    sectionHeader('📈', '热门话题榜（Top 8-10）'),
    { type: 'TextBlock', text: '暂无满足条件的候选', wrap: true, isSubtle: true },
    sectionHeader('🗣️', 'AI自媒体声音（Top 3-5）'),
    { type: 'TextBlock', text: '暂无满足条件的候选', wrap: true, isSubtle: true },
    sectionHeader('🧭', '小结与展望'),
    { type: 'TextBlock', text: '过去24小时，X上的AI讨论重点集中在模型应用落地与工作流重构。设计相关议题占比约40%，高频主题为AI交互流程、设计工具整合与Design-to-Code协作。短期内，围绕Agent UX与多模态设计协同的话题仍将持续发酵', wrap: true }
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

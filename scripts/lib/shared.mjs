/**
 * Shared utilities for ai_design_daily scripts.
 */

export function parseCliArgs(argv = process.argv.slice(2)) {
  return {
    raw: argv,
    get(name, fallback) {
      const i = argv.indexOf(name);
      return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
    },
    has(name) {
      return argv.includes(name);
    }
  };
}

export function todayDateString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}年${m}月${d}日`;
}

// ── Adaptive Card builders ──────────────────────────────────────

export function sectionHeader(emoji, title) {
  return {
    type: 'TextBlock',
    text: `${emoji} ${title}`,
    weight: 'Bolder',
    size: 'Medium',
    separator: true,
    spacing: 'Large',
    wrap: true
  };
}

export function itemBlocks(item) {
  return [
    { type: 'TextBlock', text: item.title, weight: 'Bolder', wrap: true, spacing: 'Medium' },
    { type: 'TextBlock', text: item.summary, wrap: true, spacing: 'Small' },
    { type: 'TextBlock', text: `👉 [点击查看](${item.url})`, wrap: true, spacing: 'Small', isSubtle: true }
  ];
}

export function buildCard(dateLine, data) {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', text: dateLine, isSubtle: true, spacing: 'None', wrap: true },
      { type: 'TextBlock', text: 'AI设计日报Beta（TAI-IPX x 🦞）', size: 'Large', weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: '追踪过去24小时AI前沿热点事件', isSubtle: true, spacing: 'None', wrap: true },
      sectionHeader('📌', 'TOP 10'),
      ...data.top10.flatMap(itemBlocks),
      sectionHeader('🧭', '小结与展望'),
      { type: 'TextBlock', text: data.summary.paragraph, wrap: true, spacing: 'Medium' }
    ]
  };
}

/**
 * Wrap an Adaptive Card in the standard Teams Workflow Webhook envelope.
 *
 * Teams Workflow webhooks (the replacement for legacy O365 Connectors since 2024)
 * require this exact structure. If your webhook is a custom Power Automate flow
 * that expects a different shape, adjust accordingly.
 *
 * Legacy O365 Connectors used MessageCard format — those are deprecated.
 */
export function wrapCardForTeams(card) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: card
    }]
  };
}

// ── Webhook URL resolution ──────────────────────────────────────

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';

export function resolveWebhookUrls({ envKey = 'TEAMS_WEBHOOK_URL', cliUrl = '', baseDir } = {}) {
  const webhookFile = join(baseDir, '.teams-webhook');
  const fileWebhooks = existsSync(webhookFile)
    ? readFileSync(webhookFile, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    : [];
  const all = [process.env[envKey], cliUrl, ...fileWebhooks].filter(Boolean);
  return [...new Set(all)];
}


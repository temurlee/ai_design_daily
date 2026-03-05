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
    ? readFileSync(webhookFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    : [];
  const all = [process.env[envKey], cliUrl, ...fileWebhooks].filter(Boolean);
  return [...new Set(all)];
}

// ── xAI / Grok search helper ────────────────────────────────────

/**
 * Resolve xAI API key from (in priority order):
 *   1. XAI_API_KEY env var
 *   2. .xai-api-key file in baseDir
 * Returns empty string if none found.
 */
export function resolveXaiApiKey(baseDir) {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY.trim();
  const keyFile = join(baseDir, '.xai-api-key');
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
  return '';
}

/**
 * Use xAI Grok to search X/Twitter for recent tweets from given handles.
 *
 * Sends a single chat-completion request with search enabled.
 * Grok returns structured tweet data that we parse into our item format.
 *
 * @param {string[]} handles  - e.g. ['@dotey', '@figma']
 * @param {object}   opts
 * @param {string}   opts.apiKey
 * @param {number}   opts.hours  - time window
 * @param {string[]} opts.targetIds - specific status IDs we want content for (optional)
 * @returns {Array<{id,url,snippet,author,favorites,retweets,created_timestamp}>}
 */
export async function xaiSearchTweets(handles, { apiKey, hours = 24, targetIds = [] } = {}) {
  if (!apiKey) throw new Error('xAI API key not configured');

  const handleList = handles.map(h => h.replace(/^@/, '')).join(', ');
  const idHint = targetIds.length > 0
    ? `\nSpecifically, try to find content for these tweet IDs: ${targetIds.slice(0, 20).join(', ')}`
    : '';

  const prompt = `Search X/Twitter for the most recent tweets (within the last ${hours} hours) from these accounts: ${handleList}.${idHint}

For each tweet found, return a JSON array. Each element should have:
- "id": the tweet/status ID (numeric string)
- "url": full tweet URL (https://x.com/user/status/ID)
- "author": @handle
- "text": full tweet text
- "created_timestamp": unix timestamp in seconds (if available, otherwise 0)
- "favorites": like count (if available, otherwise 0)
- "retweets": retweet count (if available, otherwise 0)

Return ONLY the JSON array, no markdown fences, no explanation.`;

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      messages: [{ role: 'user', content: prompt }],
      search_mode: 'auto',
      temperature: 0
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`xAI API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = (data?.choices?.[0]?.message?.content || '').trim();

  try {
    const jsonStart = raw.indexOf('[');
    const jsonEnd = raw.lastIndexOf(']');
    if (jsonStart < 0 || jsonEnd < 0) return [];
    const arr = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(arr)) return [];

    return arr
      .filter(t => t && (t.id || t.url))
      .map(t => ({
        _id: String(t.id || ''),
        url: t.url || '',
        snippet: String(t.text || t.snippet || ''),
        author: t.author || '',
        created_timestamp: Number(t.created_timestamp || 0) || null,
        favorites: Number(t.favorites || t.likes || 0) || 0,
        retweets: Number(t.retweets || 0) || 0,
        _source: 'xai-grok'
      }));
  } catch {
    return [];
  }
}

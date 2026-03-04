#!/usr/bin/env node
import { execFile } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const hours = Number(arg('--hours', '24'));
const dateArg = arg('--date', null);
const reportFileArg = arg('--report-file', '');
const webhookFile = join(dirname(__dirname), '.teams-webhook');
const fileWebhooks = existsSync(webhookFile) 
  ? readFileSync(webhookFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  : [];
const webhookUrls = [process.env.TEAMS_WEBHOOK_URL, arg('--webhook', ''), ...fileWebhooks].filter(Boolean);
const dryRun = args.includes('--dry-run');

function runGenerate() {
  return new Promise((resolve, reject) => {
    const script = join(__dirname, 'generate_report.mjs');
    const cmdArgs = [script, '--hours', String(hours)];
    if (dateArg) cmdArgs.push('--date', dateArg);

    execFile('node', cmdArgs, { maxBuffer: 20 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

function readReportFile(filePath) {
  const fullPath = filePath.startsWith('/') ? filePath : join(dirname(__dirname), filePath);
  if (!existsSync(fullPath)) throw new Error(`Report file not found: ${fullPath}`);
  return readFileSync(fullPath, 'utf8').trim();
}

function getDateLine(text) {
  return (text.match(/\d{4}年\d{2}月\d{2}日/) || [''])[0] || `${new Date().getUTCFullYear()}年${String(new Date().getUTCMonth() + 1).padStart(2, '0')}月${String(new Date().getUTCDate()).padStart(2, '0')}日`;
}

function sectionSlice(text, start, endList) {
  const s = text.indexOf(start);
  if (s < 0) return '';
  const from = s + start.length;
  let to = text.length;
  for (const e of endList) {
    const p = text.indexOf(e, from);
    if (p >= 0) to = Math.min(to, p);
  }
  return text.slice(from, to).trim();
}

function parseItems(sectionText) {
  const out = [];
  const lines = sectionText.split('\n');
  let cur = null;

  const pushCur = () => {
    if (!cur || !cur.title) return;
    out.push({
      title: cur.title,
      summary: cur.summary.join(' ').replace(/\s+/g, ' ').trim(),
      url: cur.url || ''
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^\d+\./.test(line)) {
      pushCur();
      cur = { title: line.replace(/^\d+\.\s*/, '').trim(), summary: [], url: '' };
      continue;
    }

    if (!cur) continue;

    const u = (line.match(/https?:\/\/x\.com\/[^\s*]+\/status\/\d+/i) || [''])[0];
    if (u) {
      cur.url = u;
      continue;
    }

    const s = line.replace(/^>\s*/, '').replace(/^\*链接：?/, '').replace(/\*$/g, '').trim();
    if (s && !/^(链接：|\*)/.test(s)) cur.summary.push(s);
  }

  pushCur();
  return out;
}

function ensureSummary(summary) {
  let s = (summary || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (!/设计|设计师|UI|UX|交互|体验|设计系统|产品/i.test(s)) {
    s += ' 这也会影响产品交互路径与设计协作效率。';
  }
  if (s.length < 100) s += ' 对团队而言，这条信息可作为近期产品与设计协同决策的参考。';
  if (s.length > 140) s = s.slice(0, 139) + '…';
  return s;
}

function ensureUrl(url) {
  if (/^https?:\/\/x\.com\/.+\/status\/\d+/.test(url)) return url;
  return '';
}

function parseReport(raw) {
  const top10Text = sectionSlice(raw, '📌 TOP 10', ['🧭 小结与展望']);
  let top10 = parseItems(top10Text);
  top10 = top10.slice(0, 10);

  for (const it of top10) {
    it.summary = ensureSummary(it.summary, it.title);
    it.url = ensureUrl(it.url);
  }

  const summaryPart = sectionSlice(raw, '🧭 小结与展望', []);
  const paragraph = summaryPart
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || '过去24小时AI圈整体情绪与趋势、可能持续发酵的话题及对设计/产品形态的短期影响，详见当日推文。';

  return { top10, summary: { paragraph } };
}

function validateStructured(data) {
  const issues = [];
  if (data.top10.length !== 10) issues.push(`TOP 10 数量异常（${data.top10.length}/10）`);
  if (!data.summary?.paragraph || !String(data.summary.paragraph).trim()) issues.push('小结与展望缺失或为空');

  data.top10.forEach((it, idx) => {
    if (!it.title) issues.push(`TOP 10 第${idx + 1}条标题缺失`);
    if (!it.url) issues.push(`TOP 10 第${idx + 1}条链接缺失/非法`);
    if (/该帖在过去\d+小时内获得较高讨论度/.test(it.summary)) issues.push(`TOP 10 第${idx + 1}条为占位摘要，非真实内容`);
    if (it.summary.length < 100 || it.summary.length > 140) issues.push(`TOP 10 第${idx + 1}条摘要长度异常（${it.summary.length}）`);
  });

  return issues;
}

function sectionHeader(emoji, title) {
  return { type: 'TextBlock', text: `${emoji} ${title}`, weight: 'Bolder', size: 'Medium', separator: true, spacing: 'Large', wrap: true };
}

function itemBlocks(item, idx) {
  return [
    { type: 'TextBlock', text: `${idx + 1}. ${item.title}`, weight: 'Bolder', wrap: true, spacing: 'Medium' },
    { type: 'TextBlock', text: item.summary, wrap: true, spacing: 'Small' },
    { type: 'TextBlock', text: `👉 [点击查看](${item.url})`, wrap: true, spacing: 'Small', isSubtle: true }
  ];
}

function buildCard(dateLine, data) {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', text: dateLine, isSubtle: true, spacing: 'None', wrap: true },
      { type: 'TextBlock', text: 'AI设计日报Beta（TAI-IPX x 🦞）', size: 'Large', weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: '追踪过去24小时AI前沿热点事件', isSubtle: true, spacing: 'None', wrap: true },

      sectionHeader('📌', 'TOP 10'),
      ...data.top10.flatMap((x, i) => itemBlocks(x, i)),

      sectionHeader('🧭', '小结与展望'),
      { type: 'TextBlock', text: data.summary.paragraph, wrap: true, spacing: 'Medium' }
    ]
  };
}

async function main() {
  const raw = reportFileArg ? readReportFile(reportFileArg) : await runGenerate();
  const dateLine = getDateLine(raw);
  const data = parseReport(raw);
  const issues = validateStructured(data);
  if (issues.length) throw new Error(`发送前校验失败：${issues.join('；')}`);

  const card = buildCard(dateLine, data);

  if (dryRun || webhookUrls.length === 0) {
    console.log(JSON.stringify({ card }, null, 2));
    if (webhookUrls.length === 0) console.error('\n⚠️  No webhook URL set. Set TEAMS_WEBHOOK_URL env var or pass --webhook');
    process.exit(0);
  }

  let allOk = true;
  for (let i = 0; i < webhookUrls.length; i++) {
    const url = webhookUrls[i];
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card })
    });
    console.log(`Webhook ${i + 1}/${webhookUrls.length}: ${res.status} ${res.statusText}`);
    if (!res.ok) {
      const body = await res.text();
      console.error(body);
      allOk = false;
    }
  }
  if (!allOk) process.exit(1);
  console.log('✅ Report sent to all Teams webhooks');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

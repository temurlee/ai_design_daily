#!/usr/bin/env node
import { execFile } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import {
  parseCliArgs,
  buildCard,
  wrapCardForTeams,
  resolveWebhookUrls
} from './lib/shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const cli = parseCliArgs();

const hours = Number(cli.get('--hours', '24'));
const dateArg = cli.get('--date', null);
const reportFileArg = cli.get('--report-file', '');
const dryRun = cli.has('--dry-run');

const webhookUrls = resolveWebhookUrls({
  cliUrl: cli.get('--webhook', ''),
  baseDir
});

// ── Report generation (fallback) ────────────────────────────────

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
  const fullPath = filePath.startsWith('/') ? filePath : join(baseDir, filePath);
  if (!existsSync(fullPath)) throw new Error(`Report file not found: ${fullPath}`);
  return readFileSync(fullPath, 'utf8').trim();
}

// ── Markdown parsing ────────────────────────────────────────────

function getDateLine(text) {
  return (text.match(/\d{4}年\d{2}月\d{2}日/) || [''])[0]
    || `${new Date().getUTCFullYear()}年${String(new Date().getUTCMonth() + 1).padStart(2, '0')}月${String(new Date().getUTCDate()).padStart(2, '0')}日`;
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

    const linkMatch = line.match(/👉\s*\[点击查看\]\((https?:\/\/[^)]+)\)/);
    if (linkMatch) {
      if (cur) {
        cur.url = linkMatch[1];
        pushCur();
        cur = null;
      }
      continue;
    }

    if (/^\d+\./.test(line)) {
      pushCur();
      cur = { title: line.replace(/^\d+\.\s*/, '').trim(), summary: [], url: '' };
      continue;
    }

    if (!cur) {
      cur = { title: line, summary: [], url: '' };
      continue;
    }

    const u = (line.match(/https?:\/\/x\.com\/[^\s*]+\/status\/\d+/i) || [''])[0];
    if (u) {
      cur.url = u;
      pushCur();
      cur = null;
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
  if (s.length > 140) s = s.slice(0, 139) + '。';
  return s;
}

function ensureUrl(url) {
  if (/^https?:\/\/x\.com\/.+\/status\/\d+/.test(url)) return url;
  return '';
}

function parseReport(raw, fromReportFile = false) {
  const top10Text = sectionSlice(raw, '📌 TOP 10', ['🧭 小结与展望']);
  let top10 = parseItems(top10Text);
  top10 = top10.slice(0, 10);

  for (const it of top10) {
    if (!fromReportFile) it.summary = ensureSummary(it.summary);
    it.url = ensureUrl(it.url);
  }

  const summaryPart = sectionSlice(raw, '🧭 小结与展望', []);
  const paragraph = summaryPart
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || (fromReportFile ? '' : '过去24小时AI圈整体情绪与趋势、可能持续发酵的话题及对设计/产品形态的短期影响，详见当日推文。');

  return { top10, summary: { paragraph } };
}

// ── Validation (red-line checks from SKILL.md) ──────────────────

function validateStructured(data) {
  const issues = [];
  if (data.top10.length !== 10) issues.push(`[红线] TOP 10 条数必须为 10，当前为 ${data.top10.length}`);
  if (!data.summary?.paragraph || !String(data.summary.paragraph).trim()) issues.push('[红线] 小结与展望缺失或为空');

  const seenUrls = new Set();
  data.top10.forEach((it, idx) => {
    if (!it.title) issues.push(`TOP 10 第${idx + 1}条标题缺失`);
    if (!it.url) issues.push(`TOP 10 第${idx + 1}条链接缺失/非法`);
    if (seenUrls.has(it.url)) issues.push(`[红线] TOP 10 内重复 URL：${it.url}`);
    if (it.url) seenUrls.add(it.url);
    if (/该帖在过去\d+小时内获得较高讨论度/.test(it.summary)) issues.push(`[红线] TOP 10 第${idx + 1}条为占位摘要，非真实内容`);
    if (it.summary.length < 100 || it.summary.length > 140) issues.push(`[红线] TOP 10 第${idx + 1}条摘要长度异常（${it.summary.length}字，要求 100-140）`);
    if (/[…．]\s*$/.test(String(it.summary).trim())) issues.push(`[红线] TOP 10 第${idx + 1}条摘要不得以省略号结尾`);
    if (/\.\.\.\s*$/.test(String(it.summary).trim())) issues.push(`[红线] TOP 10 第${idx + 1}条摘要不得以省略号结尾`);
  });

  return issues;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const raw = reportFileArg ? readReportFile(reportFileArg) : await runGenerate();
  const dateLine = getDateLine(raw);
  const data = parseReport(raw, !!reportFileArg);
  const issues = validateStructured(data);
  if (issues.length) throw new Error(`发送前校验失败（红线命中即不发送）：${issues.join('；')}`);

  const card = buildCard(dateLine, data);

  if (dryRun || webhookUrls.length === 0) {
    console.log(JSON.stringify(wrapCardForTeams(card), null, 2));
    if (webhookUrls.length === 0) console.error('\n⚠️  No webhook URL set. Set TEAMS_WEBHOOK_URL env var or pass --webhook');
    process.exit(0);
  }

  let allOk = true;
  for (let i = 0; i < webhookUrls.length; i++) {
    const url = webhookUrls[i];
    /**
     * Teams Workflow Webhook (post-2024, replaces O365 Connectors) expects:
     * { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] }
     *
     * If using a custom Power Automate flow that parses `{ card }` directly,
     * switch to: JSON.stringify({ card })
     */
    const payload = wrapCardForTeams(card);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

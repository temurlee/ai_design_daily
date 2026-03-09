#!/usr/bin/env node
/**
 * build_account_attempts.mjs — Per-account collection status report.
 *
 * Reads cache/camofox-urls.txt (JSON Lines or plain URLs), applies a --hours
 * time window, and compares against references/query-presets.json to produce
 * cache/account-attempts.json.
 *
 * Statuses:
 *   ok      — at least one tweet URL within the time window
 *   empty   — account attempted but zero tweets in window (official accounts)
 *   expired — URLs exist but all outside the time window
 *   error   — no URLs found at all (non-official accounts)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const cli = parseCliArgs();

const hours = Number(cli.get('--hours', '24'));
const cutoff = Date.now() - hours * 3600 * 1000;

const presetsPath = join(baseDir, 'references/query-presets.json');
const urlsPath = join(baseDir, cli.get('--input', 'cache/camofox-urls.txt'));
const outPath = join(baseDir, cli.get('--output', 'cache/account-attempts.json'));

if (!existsSync(presetsPath)) {
  console.error('missing presets file');
  process.exit(1);
}

const presets = JSON.parse(readFileSync(presetsPath, 'utf8'));
const allHandles = [...(presets.bloggers || []), ...(presets.official || [])].map(h => String(h).toLowerCase());
const officialSet = new Set((presets.official || []).map(h => String(h).toLowerCase()));

const lines = existsSync(urlsPath)
  ? readFileSync(urlsPath, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  : [];

const inWindowCounts = new Map();
const expiredCounts = new Map();
const totalCounts = new Map();

for (const line of lines) {
  let url = '';
  let ts = null;

  if (line.startsWith('{')) {
    try {
      const obj = JSON.parse(line);
      url = obj.url || '';
      ts = Number(obj.created_timestamp || 0) || null;
    } catch { continue; }
  } else {
    url = line;
  }

  const m = url.match(/x\.com\/([^/]+)\/status\/(\d+)/i);
  if (!m) continue;
  const h = `@${m[1]}`.toLowerCase();

  totalCounts.set(h, (totalCounts.get(h) || 0) + 1);

  if (ts && ts * 1000 < cutoff) {
    expiredCounts.set(h, (expiredCounts.get(h) || 0) + 1);
  } else {
    inWindowCounts.set(h, (inWindowCounts.get(h) || 0) + 1);
  }
}

const attempts = {};
for (const h of allHandles) {
  const inWindow = inWindowCounts.get(h) || 0;
  const expired = expiredCounts.get(h) || 0;
  const total = totalCounts.get(h) || 0;

  if (inWindow > 0) {
    attempts[h] = {
      status: 'ok',
      urlCount: inWindow,
      expiredCount: expired,
      reason: `${hours}h 窗口内采集到 ${inWindow} 条`
    };
  } else if (expired > 0) {
    attempts[h] = {
      status: 'expired',
      urlCount: 0,
      expiredCount: expired,
      reason: `有 ${expired} 条 URL 但均超出 ${hours} 小时窗口`
    };
  } else if (total === 0 && officialSet.has(h)) {
    attempts[h] = {
      status: 'empty',
      urlCount: 0,
      expiredCount: 0,
      reason: `过去 ${hours} 小时内无可用新帖`
    };
  } else {
    attempts[h] = {
      status: 'error',
      urlCount: 0,
      expiredCount: 0,
      reason: total === 0
        ? '本轮未采集到 URL（可能是页面访问/采集失败）'
        : `有 ${total} 条 URL 但均无法解析或超窗`
    };
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(attempts, null, 2), 'utf8');
console.log(`wrote ${Object.keys(attempts).length} account attempts -> ${outPath}`);

const okCount = Object.values(attempts).filter(a => a.status === 'ok').length;
const expCount = Object.values(attempts).filter(a => a.status === 'expired').length;
const emptyCount = Object.values(attempts).filter(a => a.status === 'empty').length;
const errCount = Object.values(attempts).filter(a => a.status === 'error').length;
console.log(`  ok: ${okCount}  expired: ${expCount}  empty: ${emptyCount}  error: ${errCount}`);

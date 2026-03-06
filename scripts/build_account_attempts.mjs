#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);

const presetsPath = join(baseDir, 'references/query-presets.json');
const urlsPath = join(baseDir, 'cache/camofox-urls.txt');
const outPath = join(baseDir, 'cache/account-attempts.json');

if (!existsSync(presetsPath)) {
  console.error('missing presets file');
  process.exit(1);
}

const presets = JSON.parse(readFileSync(presetsPath, 'utf8'));
const handles = [...(presets.bloggers || []), ...(presets.official || [])].map(h => String(h).toLowerCase());
const officialSet = new Set((presets.official || []).map(h => String(h).toLowerCase()));

const lines = existsSync(urlsPath)
  ? readFileSync(urlsPath, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  : [];

const counts = new Map();
for (const line of lines) {
  const m = line.match(/x\.com\/([^/]+)\/status\/(\d+)/i);
  if (!m) continue;
  const h = `@${m[1]}`.toLowerCase();
  counts.set(h, (counts.get(h) || 0) + 1);
}

const attempts = {};
for (const h of handles) {
  const c = counts.get(h) || 0;
  if (c > 0) {
    attempts[h] = { status: 'ok', urlCount: c, reason: `采集到 ${c} 条 status URL` };
  } else {
    attempts[h] = {
      status: officialSet.has(h) ? 'empty' : 'error',
      urlCount: 0,
      reason: officialSet.has(h)
        ? '过去24小时内无可用新帖'
        : '本轮未采集到URL（可能是页面访问/滚动采集失败）'
    };
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(attempts, null, 2), 'utf8');
console.log(`wrote ${Object.keys(attempts).length} account attempts -> ${outPath}`);

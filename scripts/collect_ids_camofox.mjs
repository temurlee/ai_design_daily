#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const args = process.argv.slice(2);

function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const input = join(baseDir, arg('--input', 'cache/camofox-urls.txt'));
const output = join(baseDir, arg('--output', 'cache/camofox-latest-ids.json'));
const hours = Number(arg('--hours', '48'));
const cutoff = Date.now() - hours * 3600 * 1000;

function parseStatus(url) {
  const m = String(url).match(/https?:\/\/(?:x|twitter)\.com\/([^\/\s]+)\/status\/(\d+)/i);
  if (!m) return null;
  return { handle: `@${m[1]}`.toLowerCase(), id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` };
}

function parseLine(line) {
  // 支持：
  // 1) 纯 URL
  // 2) JSON 行：{"url":"...","created_timestamp":1234567890}
  const t = line.trim();
  if (!t) return null;

  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t);
      const p = parseStatus(obj.url || '');
      if (!p) return null;
      const ts = Number(obj.created_timestamp || obj.ts || 0) || null;
      return { ...p, created_timestamp: ts };
    } catch {
      return null;
    }
  }

  const p = parseStatus(t);
  if (!p) return null;
  return { ...p, created_timestamp: null };
}

if (!existsSync(input)) {
  console.error(`input not found: ${input}`);
  console.error('Put status URLs (or JSON lines with url/created_timestamp) into this file first.');
  process.exit(1);
}

const lines = readFileSync(input, 'utf8').split(/\r?\n/);
const items = [];
for (const line of lines) {
  const x = parseLine(line);
  if (!x) continue;
  if (x.created_timestamp && x.created_timestamp * 1000 < cutoff) continue;
  items.push(x);
}

const dedup = new Map();
for (const x of items) dedup.set(x.id, x);
const out = {
  generatedAt: new Date().toISOString(),
  source: 'camofox-manual-export',
  items: [...dedup.values()]
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(out, null, 2), 'utf8');
console.log(`wrote ${out.items.length} ids -> ${output}`);

#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const cli = parseCliArgs();

const input = join(baseDir, cli.get('--input', 'cache/camofox-urls.txt'));
const output = join(baseDir, cli.get('--output', 'cache/camofox-latest-ids.json'));
const hours = Number(cli.get('--hours', '48'));
const cutoff = Date.now() - hours * 3600 * 1000;

function parseStatus(url) {
  const m = String(url).match(/https?:\/\/(?:x|twitter)\.com\/([^\/\s]+)\/status\/(\d+)/i);
  if (!m) return null;
  return { handle: `@${m[1]}`.toLowerCase(), id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` };
}

/**
 * Parse a single line from camofox-urls.txt.
 *
 * Supported formats:
 *   1) Plain URL
 *   2) JSON line (minimal):  {"url":"...","created_timestamp":1234567890}
 *   3) JSON line (rich):     {"url":"...","text":"...","author":"...","created_timestamp":...,"favorites":0,"retweets":0}
 *
 * Rich format allows Camofox to pass tweet content directly, avoiding a fxtwitter round-trip.
 */
function parseLine(line) {
  const t = line.trim();
  if (!t) return null;

  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t);
      const p = parseStatus(obj.url || '');
      if (!p) return null;
      const ts = Number(obj.created_timestamp || obj.ts || 0) || null;
      return {
        ...p,
        created_timestamp: ts,
        snippet: obj.text || obj.snippet || obj.full_text || '',
        author: obj.author || obj.screen_name || p.handle || '',
        favorites: Number(obj.favorites || obj.likes || 0) || 0,
        retweets: Number(obj.retweets || obj.retweet_count || 0) || 0
      };
    } catch {
      return null;
    }
  }

  const p = parseStatus(t);
  if (!p) return null;
  return { ...p, created_timestamp: null, snippet: '', author: '', favorites: 0, retweets: 0 };
}

if (!existsSync(input)) {
  console.error(`input not found: ${input}`);
  console.error('Put status URLs (or JSON lines with url/text/created_timestamp) into this file first.');
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
for (const x of items) {
  if (!dedup.has(x.id) || (x.snippet && !dedup.get(x.id).snippet)) {
    dedup.set(x.id, x);
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  source: 'camofox-manual-export',
  items: [...dedup.values()]
};

const withContent = out.items.filter(i => i.snippet).length;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(out, null, 2), 'utf8');
console.log(`wrote ${out.items.length} ids (${withContent} with content) -> ${output}`);

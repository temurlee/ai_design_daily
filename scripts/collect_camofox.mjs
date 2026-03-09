#!/usr/bin/env node
/**
 * collect_camofox.mjs — Real-time tweet collection from all tracked accounts.
 *
 * Requires Camofox browser via CDP:
 *   - CAMOFOX_WS_ENDPOINT (or BROWSER_WS_ENDPOINT) environment variable
 *   - puppeteer-core installed
 *
 * Output: JSON Lines → cache/camofox-urls.txt
 *   Each line: {"url","text","author","created_timestamp","favorites","retweets"}
 *   Compatible with collect_ids_camofox.mjs parseLine().
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const cli = parseCliArgs();

const hours = Number(cli.get('--hours', '24'));
const cutoff = Date.now() - hours * 3600 * 1000;
const output = join(baseDir, cli.get('--output', 'cache/camofox-urls.txt'));

const presets = JSON.parse(readFileSync(join(baseDir, 'references/query-presets.json'), 'utf8'));
const handles = [...(presets.bloggers || []), ...(presets.official || [])];

if (handles.length === 0) {
  console.error('ERROR: no handles found in references/query-presets.json');
  process.exit(1);
}

// ── Pre-flight: Camofox must be available ────────────────────────

const wsEndpoint = process.env.CAMOFOX_WS_ENDPOINT || process.env.BROWSER_WS_ENDPOINT || '';

if (!wsEndpoint) {
  console.error('ERROR: Camofox is required for tweet collection.');
  console.error('');
  console.error('  Set CAMOFOX_WS_ENDPOINT (or BROWSER_WS_ENDPOINT) to the WebSocket URL');
  console.error('  of a running Camofox / Chrome DevTools Protocol instance.');
  console.error('');
  console.error('  Example:  CAMOFOX_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/xxx');
  console.error('');
  console.error('  In OpenClaw, Camofox is built-in and the env var is set automatically.');
  console.error('  Outside OpenClaw, you need a CDP-compatible browser running.');
  process.exit(1);
}

let hasPuppeteer = false;
try { await import('puppeteer-core'); hasPuppeteer = true; } catch { /* not installed */ }

if (!hasPuppeteer) {
  console.error('ERROR: puppeteer-core is required but not installed.');
  console.error('');
  console.error('  Run:  npm install');
  console.error('  Or:   npm install puppeteer-core');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function statusIdFromUrl(url) {
  const m = String(url).match(/\/status\/(\d+)/);
  return m ? m[1] : '';
}

// ── Camofox via CDP ──────────────────────────────────────────────

let _browser = null;

async function getCamofoxBrowser() {
  if (_browser) return _browser;
  const puppeteer = (await import('puppeteer-core')).default;
  _browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  return _browser;
}

async function closeCamofoxBrowser() {
  if (_browser) {
    try { _browser.disconnect(); } catch { /* noop */ }
    _browser = null;
  }
}

async function collectViaCamofox(handle) {
  const browser = await getCamofoxBrowser();
  const page = await browser.newPage();
  try {
    const h = handle.replace(/^@/, '');
    await page.goto(`https://x.com/${h}`, { waitUntil: 'networkidle2', timeout: 30000 });

    const blocked = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /account.*suspended|doesn.t exist|this account|caution.*restricted/i.test(text);
    });
    if (blocked) throw new Error('account suspended/restricted/missing');

    await page.waitForSelector('article', { timeout: 15000 }).catch(() => null);
    return await scrollAndExtract(page, h);
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrollAndExtract(page, handle) {
  const tweets = [];
  const seenIds = new Set();
  const maxScrolls = 6;

  for (let i = 0; i < maxScrolls; i++) {
    const found = await page.evaluate(() => {
      const results = [];
      for (const article of document.querySelectorAll('article')) {
        let statusUrl = '';
        for (const a of article.querySelectorAll('a[href*="/status/"]')) {
          const href = a.getAttribute('href') || '';
          if (/\/status\/\d+$/.test(href)) {
            statusUrl = href.startsWith('http') ? href : `https://x.com${href}`;
            break;
          }
        }
        if (!statusUrl) continue;

        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.textContent || '' : '';

        const timeEl = article.querySelector('time[datetime]');
        const datetime = timeEl ? timeEl.getAttribute('datetime') : null;
        const ts = datetime ? Math.floor(new Date(datetime).getTime() / 1000) : 0;

        results.push({ url: statusUrl, text, ts });
      }
      return results;
    });

    for (const t of found) {
      const id = statusIdFromUrl(t.url);
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        tweets.push({
          url: t.url,
          text: t.text,
          author: `@${handle}`,
          created_timestamp: t.ts,
          favorites: 0,
          retweets: 0
        });
      }
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await sleep(1500);
  }

  return tweets;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.error(`== collect_camofox: mode=camofox, accounts=${handles.length}, hours=${hours} ==`);

  const results = { success: [], failed: [], empty: [] };
  const allLines = [];
  const globalSeen = new Set();

  for (const handle of handles) {
    const label = handle.toLowerCase();
    try {
      const tweets = await collectViaCamofox(handle);

      const inWindow = [];
      for (const t of tweets) {
        const ts = Number(t.created_timestamp || 0);
        if (ts && ts * 1000 < cutoff) continue;

        const id = statusIdFromUrl(t.url);
        if (!id || globalSeen.has(id)) continue;
        globalSeen.add(id);
        inWindow.push(t);
      }

      if (inWindow.length > 0) {
        results.success.push({ handle: label, count: inWindow.length });
        for (const t of inWindow) {
          allLines.push(JSON.stringify({
            url: t.url,
            text: t.text || '',
            author: t.author || label,
            created_timestamp: Number(t.created_timestamp || 0),
            favorites: Number(t.favorites || 0),
            retweets: Number(t.retweets || 0)
          }));
        }
      } else {
        results.empty.push(label);
      }

      console.error(`  ${label}: ${inWindow.length} tweets in ${hours}h window`);
    } catch (e) {
      results.failed.push({ handle: label, reason: e.message });
      console.error(`  ${label}: FAILED — ${e.message}`);
    }
  }

  await closeCamofoxBrowser();

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, allLines.join('\n') + (allLines.length ? '\n' : ''), 'utf8');

  const total = allLines.length;
  console.error(`\n== collection summary ==`);
  console.error(`total tweets: ${total}`);
  console.error(`success: ${results.success.length} accounts (${results.success.map(s => `${s.handle}:${s.count}`).join(', ') || 'none'})`);
  console.error(`empty (0 tweets in ${hours}h window): ${results.empty.length}${results.empty.length ? ' (' + results.empty.join(', ') + ')' : ''}`);
  console.error(`failed: ${results.failed.length}${results.failed.length ? ' (' + results.failed.map(f => `${f.handle}: ${f.reason}`).join('; ') + ')' : ''}`);
  console.error(`output: ${output}`);

  if (total === 0) {
    console.error('\nWARN: zero tweets collected. Candidates may be empty.');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});

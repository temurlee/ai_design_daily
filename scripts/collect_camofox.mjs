#!/usr/bin/env node
/**
 * collect_camofox.mjs — Real-time tweet collection via camofox-browser REST API.
 *
 * Connects to a running camofox-browser server (OpenClaw plugin or standalone).
 *   - CAMOFOX_URL: base URL of the camofox-browser server (default http://localhost:9377)
 *   - CAMOFOX_API_KEY: optional API key for authenticated endpoints
 *   - CAMOFOX_USER_ID / CAMOFOX_SESSION_KEY: optional camofox identity overrides; default to `main`
 *
 * Zero npm dependencies beyond Node built-ins (uses native fetch).
 *
 * Output: JSON Lines → cache/camofox-urls.txt
 *   Each line: {"url","text","author","created_timestamp","favorites","retweets"}
 *   Compatible with collect_ids_camofox.mjs parseLine().
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const cli = parseCliArgs();

const hours = Number(cli.get('--hours', '24'));
const cutoff = Date.now() - hours * 3600 * 1000;
const output = join(baseDir, cli.get('--output', 'cache/camofox-urls.txt'));
const diagnosticsOutput = join(baseDir, cli.get('--diagnostics-output', 'cache/camofox-diagnostics.json'));

const presets = JSON.parse(readFileSync(join(baseDir, 'references/query-presets.json'), 'utf8'));
const handles = [...(presets.bloggers || []), ...(presets.official || [])];
const accountUrls = Object.fromEntries(
  Object.entries(presets.accountUrls || {}).map(([k, v]) => [String(k).toLowerCase(), String(v)])
);

if (handles.length === 0) {
  console.error('ERROR: no handles found in references/query-presets.json');
  process.exit(1);
}

// ── Pre-flight: camofox-browser server must be reachable ──────────

function resolveCamofoxUrl() {
  if (process.env.CAMOFOX_URL) return process.env.CAMOFOX_URL.replace(/\/+$/, '');

  const candidates = [
    '/home/node/.openclaw/openclaw.json',
    join(process.env.HOME || '', '.openclaw', 'openclaw.json')
  ].filter(Boolean);

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      const match = raw.match(/"camofox-browser"[\s\S]*?"url"\s*:\s*"([^"]+)"/);
      if (match?.[1]) return match[1].replace(/\/+$/, '');
    } catch {
      // ignore and try next path
    }
  }

  return 'http://localhost:9377';
}

const CAMOFOX_URL = resolveCamofoxUrl();
const CAMOFOX_API_KEY = process.env.CAMOFOX_API_KEY || '';
const USER_ID = process.env.CAMOFOX_USER_ID || process.env.CAMOFOX_SESSION_KEY || 'main';
const SESSION_KEY = process.env.CAMOFOX_SESSION_KEY || process.env.CAMOFOX_USER_ID || 'main';

try {
  const health = await fetch(`${CAMOFOX_URL}/health`);
  if (!health.ok) throw new Error(`status ${health.status}`);
  const body = await health.json();
  if (!body.ok) throw new Error('health check returned ok=false');
  console.error(`camofox-browser connected: ${CAMOFOX_URL} (engine: ${body.engine || 'unknown'})`);
} catch (e) {
  console.error('ERROR: Cannot reach camofox-browser server.');
  console.error('');
  console.error(`  Tried: ${CAMOFOX_URL}/health`);
  console.error(`  Error: ${e.message}`);
  console.error('');
  console.error('  Set CAMOFOX_URL to the base URL of your camofox-browser server.');
  console.error('  Example:  CAMOFOX_URL=http://localhost:9377');
  console.error('');
  console.error('  In OpenClaw, install the plugin:  openclaw plugins install camofox-browser');
  console.error('  Standalone:  npx camofox-browser  or  docker run -p 9377:9377 ghcr.io/redf0x1/camofox-browser');
  process.exit(1);
}

// ── REST API helpers ─────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function statusIdFromUrl(url) {
  const m = String(url).match(/\/status\/(\d+)/);
  return m ? m[1] : '';
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (CAMOFOX_API_KEY) headers['Authorization'] = `Bearer ${CAMOFOX_API_KEY}`;

  const res = await fetch(`${CAMOFOX_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`camofox ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }

  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ── Tweet extraction JS (runs inside camofox-browser via evaluate) ─

const EXTRACT_TWEETS_JS = `(() => {
  const results = [];
  for (const article of document.querySelectorAll('article')) {
    let statusUrl = '';
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const href = a.getAttribute('href') || '';
      if (/\\/status\\/\\d+$/.test(href)) {
        statusUrl = href.startsWith('http') ? href : 'https://x.com' + href;
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
  return JSON.stringify(results);
})()`;

const CHECK_PAGE_STATE_JS = `(() => {
  const text = document.body?.innerText || '';
  const articleCount = document.querySelectorAll('article').length;
  const linkCount = document.querySelectorAll('a[href*="/status/"]').length;
  const tweetTextCount = document.querySelectorAll('[data-testid="tweetText"]').length;
  const timeCount = document.querySelectorAll('time[datetime]').length;
  const loginWall = /don.t miss what.s happening|log in|sign up|new to x\?|join x today/i.test(text);
  const restricted = /account.*suspended|doesn.t exist|this account|caution.*restricted/i.test(text);
  return {
    title: document.title || '',
    url: location.href || '',
    articleCount,
    linkCount,
    tweetTextCount,
    timeCount,
    loginWall,
    restricted,
    bodyPreview: text.slice(0, 1200)
  };
})()`;

// ── Collection via camofox-browser REST API ──────────────────────

async function collectViaRest(handle) {
  const h = handle.replace(/^@/, '');
  const targetUrl = accountUrls[String(handle).toLowerCase()] || `https://x.com/${h}`;

  const tab = await api('POST', '/tabs', {
    userId: USER_ID,
    sessionKey: SESSION_KEY,
    url: targetUrl
  });
  const tabId = tab.tabId || tab.id || tab.targetId;
  if (!tabId) throw new Error('no tabId returned from POST /tabs');

  let pageState = {};
  try {
    await api('POST', `/tabs/${tabId}/wait`, { userId: USER_ID, sessionKey: SESSION_KEY }).catch(() => {});
    await sleep(2000);

    const pageStateResult = await api('POST', `/tabs/${tabId}/evaluate`, {
      userId: USER_ID,
      sessionKey: SESSION_KEY,
      expression: CHECK_PAGE_STATE_JS
    });
    pageState = pageStateResult.result || {};
    if (pageState.restricted === true) throw new Error('account suspended/restricted/missing');
    if (pageState.loginWall === true && Number(pageState.articleCount || 0) === 0 && Number(pageState.tweetTextCount || 0) === 0) {
      throw new Error('x-login-wall-detected: missing or expired X/Twitter cookies');
    }

    const tweets = await scrollAndExtract(tabId, h);
    return { tweets, pageState };
  } catch (e) {
    e.pageState = pageState;
    throw e;
  } finally {
    await api('DELETE', `/tabs/${tabId}`, { userId: USER_ID, sessionKey: SESSION_KEY }).catch(() => {});
  }
}

async function scrollAndExtract(tabId, handle) {
  const tweets = [];
  const seenIds = new Set();
  const maxScrolls = 6;

  for (let i = 0; i < maxScrolls; i++) {
    const evalResult = await api('POST', `/tabs/${tabId}/evaluate`, {
      userId: USER_ID,
      sessionKey: SESSION_KEY,
      expression: EXTRACT_TWEETS_JS
    });

    let found = [];
    try {
      const raw = evalResult.result || '[]';
      found = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { /* parse error, skip */ }

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

    await api('POST', `/tabs/${tabId}/scroll`, {
      userId: USER_ID,
      sessionKey: SESSION_KEY,
      direction: 'down',
      amount: 2000
    });
    await sleep(1500);
  }

  return tweets;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.error(`== collect_camofox: mode=rest-api, accounts=${handles.length}, hours=${hours} ==`);

  const results = { success: [], failed: [], empty: [] };
  let loginWallDetected = false;
  const allLines = [];
  const diagnostics = {};
  const globalSeen = new Set();

  for (const handle of handles) {
    const label = handle.toLowerCase();
    try {
      const { tweets, pageState } = await collectViaRest(handle);

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
        diagnostics[label] = {
          status: 'ok',
          tweetCount: inWindow.length,
          pageState: {
            articleCount: Number(pageState?.articleCount || 0),
            linkCount: Number(pageState?.linkCount || 0),
            tweetTextCount: Number(pageState?.tweetTextCount || 0),
            timeCount: Number(pageState?.timeCount || 0),
            loginWall: !!pageState?.loginWall,
            restricted: !!pageState?.restricted,
            title: pageState?.title || '',
            url: pageState?.url || ''
          },
          reason: `${hours}h 窗口内采集到 ${inWindow.length} 条`
        };
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
        const detailReason = pageState?.loginWall
          ? '命中登录墙，timeline 未加载'
          : Number(pageState?.articleCount || 0) === 0 && Number(pageState?.linkCount || 0) === 0
            ? '页面已打开，但未出现 article/status 链接'
            : Number(pageState?.articleCount || 0) > 0 && Number(pageState?.linkCount || 0) === 0
              ? '页面存在 article，但未提取到 status 链接'
              : '页面可访问，但过去 24 小时内无可用新帖';
        results.empty.push(label);
        diagnostics[label] = {
          status: 'empty',
          tweetCount: 0,
          pageState: {
            articleCount: Number(pageState?.articleCount || 0),
            linkCount: Number(pageState?.linkCount || 0),
            tweetTextCount: Number(pageState?.tweetTextCount || 0),
            timeCount: Number(pageState?.timeCount || 0),
            loginWall: !!pageState?.loginWall,
            restricted: !!pageState?.restricted,
            title: pageState?.title || '',
            url: pageState?.url || ''
          },
          reason: detailReason
        };
      }

      console.error(`  ${label}: ${inWindow.length} tweets in ${hours}h window`);
    } catch (e) {
      if (String(e.message || '').includes('x-login-wall-detected')) loginWallDetected = true;
      const ps = e.pageState || {};
      diagnostics[label] = {
        status: 'error',
        tweetCount: 0,
        pageState: {
          articleCount: Number(ps.articleCount || 0),
          linkCount: Number(ps.linkCount || 0),
          tweetTextCount: Number(ps.tweetTextCount || 0),
          timeCount: Number(ps.timeCount || 0),
          loginWall: !!ps.loginWall,
          restricted: !!ps.restricted,
          title: ps.title || '',
          url: ps.url || ''
        },
        reason: e.message
      };
      results.failed.push({ handle: label, reason: e.message });
      console.error(`  ${label}: FAILED — ${e.message}`);
    }
  }

  // clean up session
  await api('DELETE', `/sessions/${USER_ID}`, { sessionKey: SESSION_KEY }).catch(() => {});

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, allLines.join('\n') + (allLines.length ? '\n' : ''), 'utf8');
  writeFileSync(diagnosticsOutput, JSON.stringify(diagnostics, null, 2), 'utf8');

  const total = allLines.length;
  console.error(`\n== collection summary ==`);
  console.error(`total tweets: ${total}`);
  console.error(`success: ${results.success.length} accounts (${results.success.map(s => `${s.handle}:${s.count}`).join(', ') || 'none'})`);
  console.error(`empty (0 tweets in ${hours}h window): ${results.empty.length}${results.empty.length ? ' (' + results.empty.join(', ') + ')' : ''}`);
  console.error(`failed: ${results.failed.length}${results.failed.length ? ' (' + results.failed.map(f => `${f.handle}: ${f.reason}`).join('; ') + ')' : ''}`);
  console.error(`output: ${output}`);

  if (total === 0 && loginWallDetected) {
    console.error('\nERROR: X guest/login wall detected — missing or expired X/Twitter cookies.');
    console.error('Import fresh cookies into camofox-browser, then retry strict run.');
    process.exit(2);
  }

  if (total === 0) {
    console.error('\nWARN: zero tweets collected. Candidates may be empty.');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * generate_report.mjs — Three-tier data strategy:
 *
 *   Tier 1  Camofox  (items in ids-file that already have snippet/text)
 *   Tier 2  fxtwitter (api.fxtwitter.com/status/:id — free, no auth)
 *   Tier 3  xAI Grok (chat completion with search — paid, needs API key)
 *
 * Items from higher tiers are preferred; lower tiers only fill in gaps.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs, resolveXaiApiKey, xaiSearchTweets } from './lib/shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const presets = JSON.parse(readFileSync(join(baseDir, 'references', 'query-presets.json'), 'utf8'));
const cli = parseCliArgs();

const hours = Number(cli.get('--hours', '24'));
const dateArg = cli.get('--date', null);
const cachePathArg = cli.get('--cache', 'cache/fxtwitter-state.json');
const idsFileArg = cli.get('--ids-file', 'cache/camofox-latest-ids.json');
const cachePath = join(baseDir, cachePathArg);
const idsFilePath = join(baseDir, idsFileArg);
const discoverFallback = cli.has('--discover-fallback');
const noFxtwitter = cli.has('--no-fxtwitter');
const noXai = cli.has('--no-xai');
const now = new Date();
const reportDate = dateArg || `${now.getUTCFullYear()}年${String(now.getUTCMonth() + 1).padStart(2, '0')}月${String(now.getUTCDate()).padStart(2, '0')}日`;
const cutoff = Date.now() - hours * 3600 * 1000;

// ── Concurrency / retry config ──────────────────────────────────
const CONCURRENCY = 5;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;
const BATCH_COOLDOWN_MS = 300;

// ── Topic dedup config ──────────────────────────────────────────
const TOPIC_SIMILARITY_THRESHOLD = 0.35;

// ── Lexicons & account sets ─────────────────────────────────────

const productAccounts = new Set(['@diabrowser', '@comet', '@cursor_ai', '@tomkrcha', '@figma']);
const bloggerAccounts = new Set((presets.bloggers || []).map(x => String(x).toLowerCase()));
const officialAccounts = new Set((presets.official || []).map(x => String(x).toLowerCase()));
const allTrackedHandles = [...(presets.bloggers || []), ...(presets.official || [])];

const designLexicon = [
  'ui', 'ux', 'figma', 'design', '交互', '界面', '设计', 'workflow', 'agent ux',
  'agentic', 'token', 'component', 'prototype', 'canvas', 'design system',
  'a2ui', 'genui', 'svg', 'mcp', 'multimodal', 'generative ui', 'design-to-code'
];
const insightLexicon = [
  'why', 'because', 'tradeoff', 'heuristic', 'workflow', '实践', '方法', '框架',
  '拆解', '原理', '对比', '成本', '风险', '效率', '可用性', '一致性', '心智负担'
];
const aiLexicon = [
  'ai', '人工智能', 'llm', '大模型', 'grok', 'chatgpt', 'claude', 'gemini',
  'openai', 'anthropic', 'xai', 'agent', 'copilot', '模型', '推理'
];

// ── Helpers ─────────────────────────────────────────────────────

function statusId(url = '') {
  const m = url.match(/\/status\/(\d+)/);
  return m ? m[1] : '';
}

function handleOf(item) {
  const src = `${item.author || ''} ${item.title || ''}`;
  const m = src.match(/@[A-Za-z0-9_]+/);
  return m ? m[0].toLowerCase() : '';
}

function cleanText(s = '') {
  return String(s).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}

function hasRealText(item) {
  const t = cleanText(item.snippet || '');
  if (!t || t.length < 20) return false;
  if (/^该帖在过去\d+小时内获得较高讨论度$/.test(t)) return false;
  return true;
}

function isAiRelated(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  return aiLexicon.some(k => t.includes(k));
}

function isTrackedAuthor(item) {
  const h = handleOf(item);
  return productAccounts.has(h) || bloggerAccounts.has(h) || officialAccounts.has(h);
}

function isPersonalNoise(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  return /搬家|房东|租房|失业|日常|生活碎片|猫猫|狗狗|自拍|打卡|心情/.test(t);
}

function isDesign(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  return designLexicon.some(k => t.includes(k));
}

// ── Scoring ─────────────────────────────────────────────────────

function insightScore(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  let s = 0;
  for (const k of insightLexicon) if (t.includes(k)) s += 8;
  if (/\d+\s*(步|阶段|原则|点|条|x)/i.test(t)) s += 10;
  if (/[：:；;]/.test(item.snippet || '')) s += 5;
  if ((item.snippet || '').length > 180) s += 6;
  return s;
}

function engagementScore(item) {
  const f = Number(item.favorites || 0);
  const r = Number(item.retweets || 0);
  return Math.min(60, Math.floor(f / 80) + Math.floor(r / 30));
}

function score(item) {
  let s = 0;
  s += isDesign(item) ? 24 : 0;
  s += insightScore(item);
  s += engagementScore(item);
  if (productAccounts.has(handleOf(item))) s += 12;
  if (officialAccounts.has(handleOf(item))) s += 8;
  return s;
}

// ── Topic-level dedup (bigram Jaccard) ──────────────────────────

function bigrams(text) {
  const t = (text || '').replace(/[\s\n\r]+/g, '').toLowerCase();
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

function topicSimilarity(a, b) {
  const textA = `${a.title || ''} ${a.snippet || ''}`;
  const textB = `${b.title || ''} ${b.snippet || ''}`;
  const ba = bigrams(textA);
  const bb = bigrams(textB);
  if (ba.size === 0 || bb.size === 0) return 0;
  let intersection = 0;
  for (const bg of ba) if (bb.has(bg)) intersection++;
  return intersection / Math.min(ba.size, bb.size);
}

function deduplicateByTopic(items, threshold = TOPIC_SIMILARITY_THRESHOLD) {
  const kept = [];
  for (const item of items) {
    const isDuplicate = kept.some(k => topicSimilarity(k, item) > threshold);
    if (!isDuplicate) kept.push(item);
  }
  return kept;
}

// ── Direct-path formatters (DEPRECATED — use --candidates-only + AI) ──

function buildSummary_DEPRECATED(item, max = 140) {
  const base = cleanText(item.snippet || '').replace(/^RT\s+/i, '');
  const sentences = base.split(/[。！？!?\n]/).map(x => x.trim()).filter(Boolean);
  let lead = '';
  if (sentences.length >= 2) lead = `${sentences[0]}。${sentences[1]}。`;
  else lead = base;
  lead = lead.replace(/\s+/g, ' ').trim();
  let s = lead;
  if (s.length < 100) s += '。该动态值得关注。';
  if (s.length > max) s = s.slice(0, max - 1) + '。';
  return s;
}

function parseTitle_DEPRECATED(item) {
  const h = handleOf(item);
  const entity = h ? h.replace('@', '') : 'AI生态';
  return `${entity} 发布动态`;
}

function formatItem_DEPRECATED(i) {
  const summary = buildSummary_DEPRECATED(i);
  if (!summary) return '';
  return `${parseTitle_DEPRECATED(i)}\n${summary}\n👉 [点击查看](${i.url})`;
}

// ── Network helpers ─────────────────────────────────────────────

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchWithRetry(fn, retries = RETRY_ATTEMPTS, delay = RETRY_DELAY_MS) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}

async function fetchPool(ids, fetcher, concurrency = CONCURRENCY) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(id => fetchWithRetry(() => fetcher(id)))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
      else if (r.status === 'rejected') console.error(`warn: ${r.reason?.message || r.reason}`);
    }
    if (i + concurrency < ids.length) await new Promise(r => setTimeout(r, BATCH_COOLDOWN_MS));
  }
  return results;
}

// ── Tier 2: fxtwitter ───────────────────────────────────────────

function extractPossibleStatuses(node, acc = []) {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const x of node) extractPossibleStatuses(x, acc);
    return acc;
  }
  if (typeof node !== 'object') return acc;

  const id = String(node.id || node.tweet_id || node.status_id || '');
  const url = node.url || node.tweet_url || '';
  const text = node.text || node.full_text || node.content || '';
  const ts = Number(node.created_timestamp || node.timestamp || 0);

  if (id && (url.includes('/status/') || /^\d+$/.test(id))) {
    acc.push({ id, url: url || `https://x.com/i/status/${id}`, text, created_timestamp: ts || null });
  }
  for (const v of Object.values(node)) extractPossibleStatuses(v, acc);
  return acc;
}

async function fetchLatestByHandle(handle) {
  const h = handle.replace(/^@/, '');
  const data = await getJson(`https://api.fxtwitter.com/user/${h}`);
  const candidates = extractPossibleStatuses(data);
  const dedup = new Map();
  for (const c of candidates) if (c.id && !dedup.has(c.id)) dedup.set(c.id, c);
  return [...dedup.values()].slice(0, 60);
}

async function fetchStatusDetail(id) {
  const data = await getJson(`https://api.fxtwitter.com/status/${id}`);
  const t = data?.tweet || data?.status || data;
  const authorScreen = t?.author?.screen_name || t?.author?.username || t?.author?.name || '';
  return {
    _id: String(t?.id || id),
    url: t?.url || `https://x.com/${authorScreen || 'i'}/status/${id}`,
    title: `${authorScreen ? '@' + authorScreen : ''} ${String(t?.text || '').slice(0, 120)}`.trim(),
    snippet: String(t?.text || ''),
    author: authorScreen ? `@${authorScreen}` : '',
    posted_at: t?.created_at || null,
    created_timestamp: Number(t?.created_timestamp || 0) || null,
    favorites: Number(t?.likes || t?.favorite_count || 0) || 0,
    retweets: Number(t?.retweets || t?.retweet_count || 0) || 0
  };
}

// ── Selection ───────────────────────────────────────────────────

function pickWithRatio(pool, n, targetDesign = 0.7, exclude = new Set(), maxPerHandle = 2) {
  const out = [];
  const designNeed = Math.round(n * targetDesign);
  const handleCount = new Map();
  let d = 0;

  for (const i of pool) {
    if (exclude.has(i._id) || out.length >= n) continue;
    const h = handleOf(i) || '@unknown';
    if ((handleCount.get(h) || 0) >= maxPerHandle) continue;
    if (i._isDesign && d < designNeed) {
      out.push(i); exclude.add(i._id); d++;
      handleCount.set(h, (handleCount.get(h) || 0) + 1);
    }
  }

  for (const i of pool) {
    if (exclude.has(i._id) || out.length >= n) continue;
    const h = handleOf(i) || '@unknown';
    if ((handleCount.get(h) || 0) >= maxPerHandle) continue;
    out.push(i); exclude.add(i._id);
    handleCount.set(h, (handleCount.get(h) || 0) + 1);
  }

  return out;
}

// ── Cache ───────────────────────────────────────────────────────

function loadCache() {
  try {
    if (!existsSync(cachePath)) return { seenIds: [], updatedAt: null };
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch {
    return { seenIds: [], updatedAt: null };
  }
}

function saveCache(cache) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

function loadIdsFile() {
  try {
    if (!existsSync(idsFilePath)) return [];
    const data = JSON.parse(readFileSync(idsFilePath, 'utf8'));
    const items = Array.isArray(data) ? data : (data.items || []);
    return items
      .map(x => ({
        id: String(x.id || statusId(x.url || '') || ''),
        url: x.url || '',
        created_timestamp: Number(x.created_timestamp || x.ts || 0) || null,
        handle: x.handle || '',
        snippet: x.snippet || x.text || '',
        author: x.author || x.handle || '',
        favorites: Number(x.favorites || 0) || 0,
        retweets: Number(x.retweets || 0) || 0
      }))
      .filter(x => x.id);
  } catch {
    return [];
  }
}

// ── Main ────────────────────────────────────────────────────────

const cache = loadCache();
const seen = new Set(cache.seenIds || []);
const discovered = [];
const idsFromCamofox = loadIdsFile();

if (idsFromCamofox.length > 0) {
  for (const x of idsFromCamofox) {
    const ts = x.created_timestamp ? x.created_timestamp * 1000 : NaN;
    if (!Number.isNaN(ts) && ts < cutoff) continue;
    discovered.push({ ...x, _handle: (x.handle || '').toLowerCase() });
  }
  console.error(`info: loaded ${discovered.length} candidate ids from ${idsFileArg}`);
} else if (discoverFallback) {
  for (const handle of allTrackedHandles) {
    try {
      const latest = await fetchLatestByHandle(handle);
      for (const x of latest) {
        const ts = x.created_timestamp ? x.created_timestamp * 1000 : NaN;
        if (!Number.isNaN(ts) && ts < cutoff) continue;
        discovered.push({ ...x, _handle: handle.toLowerCase() });
      }
    } catch (e) {
      console.error(`warn: fetch ${handle} failed: ${e.message}`);
    }
  }
} else {
  console.error(`info: ids file not found (${idsFileArg}). skip discovery. pass --discover-fallback to attempt fxtwitter user discovery.`);
}

// ── Tier 1: use Camofox content directly ────────────────────────

const tier1Items = [];
const needsFetch = [];

for (const x of discovered) {
  if (x.snippet && cleanText(x.snippet).length >= 20) {
    tier1Items.push({
      _id: x.id,
      url: x.url,
      title: `${x.author || x._handle || ''} ${String(x.snippet).slice(0, 120)}`.trim(),
      snippet: x.snippet,
      author: x.author || x._handle || '',
      posted_at: null,
      created_timestamp: x.created_timestamp || null,
      favorites: x.favorites || 0,
      retweets: x.retweets || 0,
      _source: 'camofox'
    });
  } else {
    needsFetch.push(x);
  }
}

console.error(`info: tier-1 (camofox content): ${tier1Items.length} items ready`);
console.error(`info: ${needsFetch.length} items need content from fxtwitter/xai`);

// ── Tier 2: fxtwitter for items missing content ─────────────────

const tier2Items = [];

if (!noFxtwitter && needsFetch.length > 0) {
  const fetchIds = [...new Set(needsFetch.map(x => x.id).filter(Boolean))];
  const rawDetails = await fetchPool(fetchIds, async (id) => {
    const d = await fetchStatusDetail(id);
    const ts = d.created_timestamp ? d.created_timestamp * 1000 : (d.posted_at ? Date.parse(d.posted_at) : NaN);
    if (!Number.isNaN(ts) && ts < cutoff) return null;
    if (!d.url.includes('/status/')) return null;
    return { ...d, _source: 'fxtwitter' };
  });

  const fetched = rawDetails.filter(Boolean);
  const fetchedIds = new Set(fetched.map(d => d._id));

  tier2Items.push(...fetched);
  console.error(`info: tier-2 (fxtwitter): ${tier2Items.length} items fetched`);

  const stillMissing = needsFetch.filter(x => !fetchedIds.has(x.id));
  needsFetch.length = 0;
  needsFetch.push(...stillMissing);
} else if (noFxtwitter) {
  console.error('info: tier-2 (fxtwitter) skipped (--no-fxtwitter)');
}

// ── Tier 3: xAI Grok for remaining items ───────────────────────

const tier3Items = [];

if (!noXai && needsFetch.length > 0) {
  const xaiKey = resolveXaiApiKey(baseDir);
  if (xaiKey) {
    const missingHandles = [...new Set(needsFetch.map(x => x._handle || x.handle).filter(Boolean))];
    const missingIds = needsFetch.map(x => x.id).filter(Boolean);
    try {
      console.error(`info: tier-3 (xai): searching for ${missingIds.length} items from ${missingHandles.length} handles...`);
      const results = await xaiSearchTweets(
        missingHandles.length > 0 ? missingHandles : allTrackedHandles.slice(0, 10),
        { apiKey: xaiKey, hours, targetIds: missingIds }
      );

      for (const r of results) {
        if (!r._id && r.url) r._id = statusId(r.url);
        if (!r._id) continue;
        if (!r.title) r.title = `${r.author || ''} ${String(r.snippet || '').slice(0, 120)}`.trim();
        tier3Items.push(r);
      }
      console.error(`info: tier-3 (xai): ${tier3Items.length} items retrieved`);
    } catch (e) {
      console.error(`warn: tier-3 (xai) failed: ${e.message}`);
    }
  } else {
    console.error('info: tier-3 (xai) skipped — no API key (set XAI_API_KEY or create .xai-api-key)');
  }
} else if (noXai) {
  console.error('info: tier-3 (xai) skipped (--no-xai)');
}

// ── Fallback: use lite items if all tiers produced nothing ──────

const allDetails = [...tier1Items, ...tier2Items, ...tier3Items];

if (allDetails.length === 0) {
  for (const x of discovered.slice(0, 120)) {
    allDetails.push({
      _id: x.id,
      url: x.url,
      title: `${x._handle || ''} ${String(x.text || x.snippet || '').slice(0, 120)}`.trim(),
      snippet: String(x.text || x.snippet || ''),
      author: x._handle || '',
      posted_at: null,
      favorites: 0,
      retweets: 0,
      _source: 'lite-fallback'
    });
  }
}

// ── Merge & deduplicate ─────────────────────────────────────────

const byId = new Map();
for (const item of allDetails) {
  if (!item._id) continue;
  if (!byId.has(item._id)) {
    byId.set(item._id, { ...item });
  } else {
    const v = byId.get(item._id);
    if ((item.snippet || '').length > (v.snippet || '').length) v.snippet = item.snippet;
    v.favorites = Math.max(Number(v.favorites || 0), Number(item.favorites || 0));
    v.retweets = Math.max(Number(v.retweets || 0), Number(item.retweets || 0));
    if (!v.author && item.author) v.author = item.author;
  }
}

const sourceCounts = {};
for (const item of byId.values()) {
  const src = item._source || 'unknown';
  sourceCounts[src] = (sourceCounts[src] || 0) + 1;
}
console.error(`info: merged ${byId.size} unique items — sources: ${JSON.stringify(sourceCounts)}`);

// ── Score & filter ──────────────────────────────────────────────

const allItems = [...byId.values()]
  .filter(hasRealText)
  .map(i => {
    const _isDesign = isDesign(i);
    const _insight = insightScore(i);
    return { ...i, _isDesign, _insight, _score: score(i) };
  })
  .sort((a, b) => b._score - a._score);

let items = allItems.filter(i => !isPersonalNoise(i) && (isAiRelated(i) || i._isDesign));
if (items.length < 12) {
  items = allItems.filter(i => !isPersonalNoise(i) && (isAiRelated(i) || i._isDesign || isTrackedAuthor(i))).slice(0, 20);
}

items = deduplicateByTopic(items);

const used = new Set();
const top10 = pickWithRatio(items, 10, 0.7, used);
if (top10.length < 10) {
  const refill = allItems.filter(i => !used.has(i._id)).slice(0, 10 - top10.length);
  for (const i of refill) {
    top10.push(i);
    used.add(i._id);
  }
}

const allFetchedIds = [...byId.keys()];
const mergedSeen = [...new Set([...(cache.seenIds || []), ...allFetchedIds])].slice(-5000);
saveCache({ seenIds: mergedSeen, updatedAt: new Date().toISOString() });

// ── Output ──────────────────────────────────────────────────────

const candidatesOnly = cli.has('--candidates-only');
if (candidatesOnly) {
  const outArg = cli.get('--output', 'cache/candidates.json');
  const outPath = join(baseDir, outArg);
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    reportDate,
    generatedAt: new Date().toISOString(),
    sourceSummary: sourceCounts,
    candidates: top10.slice(0, 10).map((i) => ({
      id: i._id,
      url: i.url,
      author: i.author || '',
      snippet: i.snippet || '',
      title: i.title || '',
      isDesign: !!i._isDesign,
      favorites: i.favorites || 0,
      retweets: i.retweets || 0,
      source: i._source || ''
    }))
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.error(`wrote ${payload.candidates.length} candidates to ${outArg}`);
  process.exit(0);
}

// Direct-path Markdown output (DEPRECATED — prefer --candidates-only + AI generation)
console.error('warn: direct Markdown output is deprecated. Use --candidates-only and let AI generate the report per SKILL.md.');

const top10Text = top10.slice(0, 10).map(formatItem_DEPRECATED).filter(Boolean).join('\n\n');
const designCount = top10.filter(x => x._isDesign).length;
const ratio = top10.length ? Math.round((designCount / top10.length) * 100) : 0;
const summaryParagraph = `过去24小时AI圈整体情绪偏积极，开源项目与产品更新密集。短期内 Agent UX、Design-to-Code 与多模态设计协同仍会持续发酵；对设计/产品形态的影响集中在工作流整合与组件化交付效率上，值得持续关注。（设计相关内容占比约${ratio}%）`;

console.log(`${reportDate}\n《AI设计日报》\n\n📌 TOP 10\n${top10Text || '暂无满足条件的候选'}\n\n🧭 小结与展望\n${summaryParagraph}`);

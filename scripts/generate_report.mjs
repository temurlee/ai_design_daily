#!/usr/bin/env node
/**
 * generate_report.mjs — Two-tier data strategy:
 *
 *   Tier 1  Camofox  (items in ids-file that already have snippet/text)
 *   Tier 2  fxtwitter (api.fxtwitter.com/status/:id — free, no auth)
 *
 * Items from higher tiers are preferred; lower tiers only fill in gaps.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/shared.mjs';

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
const now = new Date();
const reportDate = dateArg || `${now.getUTCFullYear()}年${String(now.getUTCMonth() + 1).padStart(2, '0')}月${String(now.getUTCDate()).padStart(2, '0')}日`;
const cutoff = Date.now() - hours * 3600 * 1000;

// ── Concurrency / retry config ──────────────────────────────────
const CONCURRENCY = 5;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;
const BATCH_COOLDOWN_MS = 300;
const HTTP_TIMEOUT_MS = 12000;

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
  'ai', '人工智能', 'llm', '大模型', 'chatgpt', 'claude', 'gemini',
  'openai', 'anthropic', 'agent', 'copilot', '模型', '推理'
];
const commentaryLexicon = [
  '突然有个暴论', '笑死', '兄弟们', '哈哈', '卧槽', '终于', '不出意外', '这个就很微妙', '期待', '过来人表示'
];
const staleNewsLexicon = [
  '又来', '回顾', '复盘', '看到这种界面', '讨论和热度', '舆论的导向', '三八妇女节', '月', '上周', '昨天', '前天'
];
const launchLexicon = [
  '发布', '上线', '开源', '推出', '支持', '新增', '内测', '开放', '升级', '更新'
];
const opinionLexicon = [
  '暴论', '我觉得', '说实在', '讨厌', '笑死', '哈哈', '期待', '好玩了', '卧槽', '牛马'
];
const sellLexicon = [
  '买我的授权', '买源码', '见评论区', '安装skill', 'github见评论区', '官网地址，见评论区'
];
const weakSignalLexicon = [
  '访问不了', '会不会', '注意安全', '虽然，但是', '想把', '发现', '尝鲜', '担心', '封号'
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

function commentaryPenalty(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  let p = 0;
  for (const k of commentaryLexicon) if (t.includes(k)) p += 10;
  if (/^[@\w]+\s*(突然|笑死|兄弟们|终于)/i.test(String(item.title || ''))) p += 8;
  return p;
}

function staleNewsPenalty(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  let p = 0;
  for (const k of staleNewsLexicon) if (t.includes(k)) p += 8;
  if (!launchLexicon.some(k => t.includes(k))) p += 6;
  return p;
}

function launchBonus(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  let b = 0;
  for (const k of launchLexicon) if (t.includes(k)) b += 6;
  return Math.min(18, b);
}

function classifyEventType(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  if (sellLexicon.some(k => t.includes(k))) return 'promo';
  if (weakSignalLexicon.some(k => t.includes(k))) return 'weak-signal';
  if (/内测|beta|灰度|试用/.test(t)) return 'beta';
  if (/发布|上线|推出|开源|开放/.test(t)) return 'launch';
  if (/新增|支持|升级|更新|主题|功能/.test(t)) return 'update';
  if (/排行榜|评测|测试|对比/.test(t)) return 'benchmark';
  if (opinionLexicon.some(k => t.includes(k))) return 'opinion';
  return 'general';
}

function eventTypeBonus(type) {
  if (type === 'launch') return 16;
  if (type === 'update') return 12;
  if (type === 'beta') return 10;
  if (type === 'benchmark') return 8;
  return 0;
}

function eventTypePenalty(type) {
  if (type === 'opinion') return 18;
  if (type === 'promo') return 24;
  if (type === 'weak-signal') return 22;
  return 0;
}

function isHardNews(item) {
  const type = classifyEventType(item);
  return ['launch', 'update', 'beta', 'benchmark'].includes(type);
}

function isLowSignalGeneral(item) {
  const type = classifyEventType(item);
  const text = cleanText(`${item.title || ''} ${item.snippet || ''}`);
  if (type !== 'general') return false;
  if (text.length < 60) return true;
  if (!launchLexicon.some(k => text.toLowerCase().includes(k)) && !/排行榜|评测|测试|对比/.test(text.toLowerCase())) return true;
  if (/^[@\w]+\s*(这|那|一串|本文|想把|虽然|我觉得)/i.test(String(item.title || ''))) return true;
  return false;
}

function backfillPriority(item) {
  const type = item._eventType || classifyEventType(item);
  if (type === 'benchmark') return 60;
  if (type === 'update') return 50;
  if (type === 'launch') return 40;
  if (type === 'beta') return 30;
  if (type === 'general') return isLowSignalGeneral(item) ? -10 : 10;
  if (type === 'opinion') return 0;
  return -20;
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
  const type = classifyEventType(item);
  let s = 0;
  s += isDesign(item) ? 24 : 0;
  s += insightScore(item);
  s += engagementScore(item);
  s += launchBonus(item);
  s += eventTypeBonus(type);
  s -= commentaryPenalty(item);
  s -= staleNewsPenalty(item);
  s -= eventTypePenalty(type);
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${HTTP_TIMEOUT_MS}ms`)), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`request timeout after ${HTTP_TIMEOUT_MS}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

function pickWithDesignPolicy(pool, n, {
  targetDesignRatio = 0.7,
  minDesign = 5,
  highQualityDesignThreshold = 7,
  maxPerHandle = 2
} = {}) {
  const out = [];
  const used = new Set();
  const handleCount = new Map();

  const designPool = pool.filter(i => i._isDesign);
  const generalPool = pool.filter(i => !i._isDesign);

  // “高质量设计向”定义：设计向且综合分>=40
  const highQualityDesign = designPool.filter(i => Number(i._score || 0) >= 40);

  const targetByRatio = Math.round(n * targetDesignRatio);
  let designTarget = Math.max(minDesign, targetByRatio);

  // 若当天高质量设计向 >= 7，优先提到 7-8 条（受总量与比例目标约束）
  if (highQualityDesign.length >= highQualityDesignThreshold) {
    designTarget = Math.max(designTarget, 7);
    designTarget = Math.min(designTarget, 8);
  }

  function tryPush(item) {
    if (!item || used.has(item._id) || out.length >= n) return false;
    const h = handleOf(item) || '@unknown';
    if ((handleCount.get(h) || 0) >= maxPerHandle) return false;
    out.push(item);
    used.add(item._id);
    handleCount.set(h, (handleCount.get(h) || 0) + 1);
    return true;
  }

  // Step 1: 先从设计池拿到目标设计条数
  for (const i of designPool) {
    if (out.filter(x => x._isDesign).length >= designTarget) break;
    tryPush(i);
  }

  // Step 2: 剩余名额用非设计池补齐
  for (const i of generalPool) {
    if (out.length >= n) break;
    tryPush(i);
  }

  // Step 3: 若仍未满，再从全池补齐
  for (const i of pool) {
    if (out.length >= n) break;
    tryPush(i);
  }

  const designCount = out.filter(i => i._isDesign).length;
  return {
    items: out.slice(0, n),
    strategy: {
      targetDesignRatio,
      minDesign,
      highQualityDesignThreshold,
      highQualityDesignCount: highQualityDesign.length,
      designTarget,
      designCount,
      triggeredHighQualityBoost: highQualityDesign.length >= highQualityDesignThreshold,
      usedNonDesignBackfill: designCount < minDesign
    }
  };
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
console.error(`info: ${needsFetch.length} items need content from fxtwitter`);

// ── Tier 2: fxtwitter for items missing content ─────────────────

const tier2Items = [];

if (!noFxtwitter && needsFetch.length > 0) {
  const fetchIds = [...new Set(needsFetch.map(x => x.id).filter(Boolean))];
  const rawDetails = await fetchPool(fetchIds, async (id) => {
    const d = await fetchStatusDetail(id);
    const ts = d.created_timestamp ? d.created_timestamp * 1000 : (d.posted_at ? Date.parse(d.posted_at) : NaN);
    // 严格时窗：24h/48h 模式下，时间不明确的内容直接丢弃，避免混入旧闻
    if (Number.isNaN(ts) && hours <= 48) return null;
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

// ── Fallback: use lite items if all tiers produced nothing ──────

const allDetails = [...tier1Items, ...tier2Items];

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
    const _eventType = classifyEventType(i);
    const _isHardNews = isHardNews(i);
    return { ...i, _isDesign, _insight, _eventType, _isHardNews, _score: score(i) };
  })
  .sort((a, b) => b._score - a._score);

const basePool = allItems.filter(i => !isPersonalNoise(i) && (isAiRelated(i) || i._isDesign || isTrackedAuthor(i)));
let items = basePool.filter(i => i._isHardNews && i._eventType !== 'promo' && i._eventType !== 'weak-signal');
if (items.length < 12) {
  const fallback = basePool
    .filter(i => i._eventType !== 'promo' && i._eventType !== 'weak-signal')
    .filter(i => !(i._eventType === 'general' && isLowSignalGeneral(i)))
    .sort((a, b) => {
      const pa = backfillPriority(a);
      const pb = backfillPriority(b);
      if (pb !== pa) return pb - pa;
      return Number(b._score || 0) - Number(a._score || 0);
    });
  const merged = [...items];
  const seenIds = new Set(items.map(i => i._id));
  for (const item of fallback) {
    if (seenIds.has(item._id)) continue;
    merged.push(item);
    seenIds.add(item._id);
    if (merged.length >= 20) break;
  }
  items = merged;
}

items = deduplicateByTopic(items);

const selection = pickWithDesignPolicy(items, 10, {
  targetDesignRatio: 0.7,
  minDesign: 5,
  highQualityDesignThreshold: 7,
  maxPerHandle: 2
});
const top10 = selection.items;

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
    selection: {
      ...(selection.strategy || {}),
      total: top10.length,
      designCount: top10.filter(i => i._isDesign).length
    },
    candidates: top10.slice(0, 10).map((i) => ({
      id: i._id,
      url: i.url,
      author: i.author || '',
      snippet: i.snippet || '',
      title: i.title || '',
      isDesign: !!i._isDesign,
      eventType: i._eventType || 'general',
      isHardNews: !!i._isHardNews,
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

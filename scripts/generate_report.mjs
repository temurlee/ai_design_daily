#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);
const presets = JSON.parse(readFileSync(join(baseDir, 'references', 'query-presets.json'), 'utf8'));
const args = process.argv.slice(2);

function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const hours = Number(arg('--hours', '24'));
const dateArg = arg('--date', null);
const cachePathArg = arg('--cache', 'cache/fxtwitter-state.json');
const idsFileArg = arg('--ids-file', 'cache/camofox-latest-ids.json');
const cachePath = join(baseDir, cachePathArg);
const idsFilePath = join(baseDir, idsFileArg);
const discoverFallback = args.includes('--discover-fallback');
const now = new Date();
const reportDate = dateArg || `${now.getUTCFullYear()}年${String(now.getUTCMonth() + 1).padStart(2, '0')}月${String(now.getUTCDate()).padStart(2, '0')}日`;
const cutoff = Date.now() - hours * 3600 * 1000;

const productAccounts = new Set(['@diabrowser', '@comet', '@cursor_ai', '@tomkrcha', '@figma']);
const bloggerAccounts = new Set((presets.bloggers || []).map(x => String(x).toLowerCase()));
const designLexicon = ['ui', 'ux', 'figma', 'design', '交互', '界面', '设计', 'workflow', 'agent ux', 'agentic', 'token', 'component', 'prototype', 'canvas', 'design system', 'a2ui', 'genui', 'svg', 'mcp', 'multimodal', 'generative ui', 'design-to-code'];
const insightLexicon = ['why', 'because', 'tradeoff', 'heuristic', 'workflow', '实践', '方法', '框架', '拆解', '原理', '对比', '成本', '风险', '效率', '可用性', '一致性', '心智负担'];
const aiLexicon = ['ai', '人工智能', 'llm', '大模型', 'grok', 'chatgpt', 'claude', 'gemini', 'openai', 'anthropic', 'xai', 'agent', 'copilot', '模型', '推理'];

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
  return productAccounts.has(h) || bloggerAccounts.has(h);
}

function isPersonalNoise(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  return /搬家|房东|租房|失业|日常|生活碎片|猫猫|狗狗|自拍|打卡|心情/.test(t);
}

function isDesign(item) {
  const t = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  return designLexicon.some(k => t.includes(k));
}

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

function score(item, rank, hitCount) {
  let s = 0;
  s += Math.max(0, 32 - rank);
  s += (hitCount - 1) * 10;
  s += isDesign(item) ? 24 : 0;
  s += insightScore(item);
  s += engagementScore(item);
  if (productAccounts.has(handleOf(item))) s += 12;
  return s;
}

function whyCare(item) {
  const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  if (/figma|prototype|prototyp|原型/.test(text)) return '并将直接影响原型评审效率与交互决策速度';
  if (/agent|workflow|automation|自动化/.test(text)) return '并会改变设计师在AI工作流中的分工边界与交付效率';
  if (/code|design\-to\-code|component|token/.test(text)) return '并关系到设计系统与工程实现之间的一致性成本';
  if (/multimodal|视觉|image|video|svg/.test(text)) return '并正在拓宽视觉表达与多模态交互的设计边界';
  return '并可用于判断该趋势是否值得进入团队的产品设计路线图';
}

function detectEntity(item) {
  const h = handleOf(item);
  const map = {
    '@figma': 'Figma',
    '@openclaw': 'OpenClaw',
    '@cursor_ai': 'Cursor',
    '@diabrowser': 'Dia Browser',
    '@comet': 'Comet',
    '@tomkrcha': 'Tom Krcha'
  };
  return map[h] || (h ? h.replace('@', '') : 'AI生态');
}

function detectAction(item) {
  const t = cleanText(item.snippet || item.title || '').toLowerCase();
  if (/发布|上线|launch|release|ship|更新|update|推出/.test(t)) return '发布更新';
  if (/开源|open source|github/.test(t)) return '开源推进';
  if (/演示|demo|展示|实测/.test(t)) return '演示验证';
  if (/融资|收购|合作|sponsor|partnership/.test(t)) return '生态合作';
  return '趋势信号';
}

function detectPositioning(item) {
  if (isDesign(item)) return '面向AI设计工作流与UI/UX协同升级';
  return '反映AI产品能力与产业节奏变化';
}

function buildSummary(item, max = 140) {
  const base = cleanText(item.snippet || '').replace(/^RT\s+/i, '');
  const sentences = base.split(/[。！？!?\n]/).map(x => x.trim()).filter(Boolean);
  let lead = '';
  if (sentences.length >= 2) lead = `${sentences[0]}。${sentences[1]}。`;
  else lead = base;
  lead = lead.replace(/\s+/g, ' ').trim();
  let s = `${lead}${whyCare(item)}。`;
  if (s.length < 100) s += '对团队近期的产品设计与协作取舍有直接参考价值。';
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

function parseTitle(item) {
  return `${detectEntity(item)}${detectAction(item)}，${detectPositioning(item)}`;
}

function formatItem(i, idx) {
  const summary = buildSummary(i);
  if (!summary) return '';
  return `${idx + 1}. ${parseTitle(i)}\n> ${summary}\n>\n> *链接：${i.url}*`;
}

function formatVoiceItem(i, idx) {
  const entity = detectEntity(i);
  const action = detectAction(i);
  const summary = buildSummary(i);
  if (!summary) return '';
  const title = `${entity}${action}持续输出，形成当日高价值观点信号`;
  return `${idx + 1}. ${title}\n> ${summary}\n>\n> *链接：${i.url}*`;
}

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
      .map(x => ({ id: String(x.id || statusId(x.url || '') || ''), url: x.url || '', created_timestamp: Number(x.created_timestamp || x.ts || 0) || null, handle: x.handle || '' }))
      .filter(x => x.id);
  } catch {
    return [];
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

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

  if (id && (url.includes('/status/') || /^\d+$/.test(id))) acc.push({ id, url: url || `https://x.com/i/status/${id}`, text, created_timestamp: ts || null });
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
      out.push(i); exclude.add(i._id); d++; handleCount.set(h, (handleCount.get(h) || 0) + 1);
    }
  }
  for (const i of pool) {
    if (exclude.has(i._id) || out.length >= n) continue;
    const h = handleOf(i) || '@unknown';
    if ((handleCount.get(h) || 0) >= maxPerHandle) continue;
    out.push(i); exclude.add(i._id); handleCount.set(h, (handleCount.get(h) || 0) + 1);
  }
  return out;
}

function pickVoices(pool, n = 4) {
  const byHandle = new Map();
  for (const i of pool) {
    const h = handleOf(i);
    if (!h) continue;
    if (!byHandle.has(h) || (i._insight > byHandle.get(h)._insight)) byHandle.set(h, i);
  }
  return [...byHandle.values()]
    .sort((a, b) => (b._insight + b._score) - (a._insight + a._score))
    .slice(0, n);
}

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
  for (const handle of presets.bloggers || []) {
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

const discoveredIds = [...new Set(discovered.map(x => x.id).filter(Boolean))];
let fetchIds = discoveredIds.filter(id => !seen.has(id));
if (fetchIds.length < 28) fetchIds = [...new Set([...fetchIds, ...discoveredIds])].slice(0, 100);

const details = [];
for (const id of fetchIds) {
  try {
    const d = await fetchStatusDetail(id);
    const ts = d.created_timestamp ? d.created_timestamp * 1000 : (d.posted_at ? Date.parse(d.posted_at) : NaN);
    if (!Number.isNaN(ts) && ts < cutoff) continue;
    if (!d.url.includes('/status/')) continue;
    details.push({ ...d, _rank: 1, _source: 'fxtwitter' });
  } catch (e) {
    console.error(`warn: status ${id} detail failed: ${e.message}`);
  }
}

if (details.length === 0) {
  for (const x of discovered.slice(0, 120)) {
    details.push({ _id: x.id, url: x.url, title: `${x._handle || ''} ${String(x.text || '').slice(0, 120)}`.trim(), snippet: String(x.text || ''), author: x._handle || '', posted_at: null, favorites: 0, retweets: 0, _rank: 50, _source: 'fxtwitter-lite' });
  }
}

const byId = new Map();
for (const item of details) {
  if (!item._id) continue;
  if (!byId.has(item._id)) byId.set(item._id, { ...item, _hits: 1, _bestRank: item._rank || 50 });
  else {
    const v = byId.get(item._id);
    v._hits += 1;
    v._bestRank = Math.min(v._bestRank, item._rank || 50);
    if ((item.snippet || '').length > (v.snippet || '').length) v.snippet = item.snippet;
    v.favorites = Math.max(Number(v.favorites || 0), Number(item.favorites || 0));
    v.retweets = Math.max(Number(v.retweets || 0), Number(item.retweets || 0));
  }
}

const allItems = [...byId.values()]
  .filter(hasRealText)
  .map(i => {
    const _isDesign = isDesign(i);
    const _insight = insightScore(i);
    return { ...i, _isDesign, _insight, _score: score(i, i._bestRank, i._hits) };
  })
  .sort((a, b) => b._score - a._score);

let items = allItems.filter(i => !isPersonalNoise(i) && (isAiRelated(i) || i._isDesign));
if (items.length < 12) {
  items = allItems.filter(i => !isPersonalNoise(i) && (isAiRelated(i) || i._isDesign || isTrackedAuthor(i))).slice(0, 20);
}

const used = new Set();
const top10 = pickWithRatio(items, 10, 0.7, used);
if (top10.length < 10) {
  const refill = allItems.filter(i => !used.has(i._id)).slice(0, 10 - top10.length);
  for (const i of refill) {
    top10.push(i);
    used.add(i._id);
  }
}

const mergedSeen = [...new Set([...(cache.seenIds || []), ...fetchIds])].slice(-5000);
saveCache({ seenIds: mergedSeen, updatedAt: new Date().toISOString() });

const candidatesOnly = args.includes('--candidates-only');
if (candidatesOnly) {
  const outArg = arg('--output', 'cache/candidates.json');
  const outPath = join(baseDir, outArg);
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    reportDate,
    generatedAt: new Date().toISOString(),
    candidates: top10.slice(0, 10).map((i) => ({
      id: i._id,
      url: i.url,
      author: i.author || '',
      snippet: i.snippet || '',
      title: i.title || '',
      isDesign: !!i._isDesign,
      favorites: i.favorites || 0,
      retweets: i.retweets || 0
    }))
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.error(`wrote ${payload.candidates.length} candidates to ${outArg}`);
  process.exit(0);
}

const top10Text = top10.slice(0, 10).map((x, idx) => formatItem(x, idx)).filter(Boolean).join('\n\n');
const designCount = top10.filter(x => x._isDesign).length;
const ratio = top10.length ? Math.round((designCount / top10.length) * 100) : 0;
const summaryParagraph = `过去24小时AI圈整体情绪偏积极，开源项目与产品更新密集。短期内 Agent UX、Design-to-Code 与多模态设计协同仍会持续发酵；对设计/产品形态的影响集中在工作流整合与组件化交付效率上，值得持续关注。（设计相关内容占比约${ratio}%）`;

console.log(`${reportDate}\n《AI设计日报》\n\n📌 TOP 10\n${top10Text || '暂无满足条件的候选'}\n\n🧭 小结与展望\n${summaryParagraph}`);

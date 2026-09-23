/**
 * CCER 每日行情抓取脚本 v3（增量 · 按日期组织）
 * ---------------------------------------------------------------------------
 * 主源: https://www.ccer.com.cn/wcm/ccer/data/YYYYMMDD-first.json  (数据查询频道逐日成交明细)
 * 兜底: 每日行情详情页 .shtml
 * 输出: ccer-market-data.json —— 按日期(YYYY-MM-DD)为键的 records；
 *       已有且完好的日期自动跳过，**新增交易日 = 仅追加一条 records[新日期]，历史零改动**。
 * 用法: node _ccer_scrape.js [--full]
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const BASE_HTML = 'https://www.ccer.com.cn/wcm/ccer/html/';
const LIST_URL = 'https://www.ccer.com.cn/wcm/ccer/data/2502lshq.json';
const DATA_FILE = path.join(__dirname, 'ccer-market-data.json');
const CONCURRENCY = 2; // 低并发，避免触发创宇盾 WAF
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (s) => (s == null || s === '-' || s === '' ? null : parseFloat(String(s).replace(/,/g, '')));

function parseDetail(html, fallbackDate) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '');
  const out = { date: fallbackDate, volume: null, turnover: null, avgPrice: null };
  const m = text.match(/成交量([\d,\.]+)吨[，,]成交额([\d,\.]+)元[，,]成交均价([\d,\.]+)元\/吨/);
  if (m) { out.volume = num(m[1]); out.turnover = num(m[2]); out.avgPrice = num(m[3]); }
  else if (/无成交/.test(text)) { out.volume = 0; out.turnover = 0; }
  return out;
}

function parseDayJson(arr, date) {
  const rows = (Array.isArray(arr) ? arr : []).filter((r) => r && r.profession_name !== '小计');
  let volume = 0, turnover = 0, hasData = false;
  for (const r of rows) {
    const v = num(r.business_amount), t = num(r.business_price);
    if (v != null) { volume += v; hasData = true; }
    if (t != null) turnover += t;
  }
  const xiaoji = (Array.isArray(arr) ? arr : []).find((r) => r && r.profession_name === '小计');
  if (xiaoji) { // 以官网"小计"为准
    const v = num(xiaoji.business_amount), t = num(xiaoji.business_price);
    if (v != null) volume = v;
    if (t != null) turnover = t;
    if (v != null || t != null) hasData = true;
  }
  return {
    date,
    volume: hasData ? volume : 0,
    turnover: hasData ? turnover : 0,
    avgPrice: volume > 0 ? +(turnover / volume).toFixed(4) : null,
  };
}

async function fetchText(url, retries = 3, backoffBase = 800) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) { const e = new Error('404'); e.is404 = true; throw e; }
      if (res.status === 403) { const e = new Error('403 创宇盾WAF拦截'); e.isWaf = true; throw e; } // 立即放弃，不重试（重试会加剧封禁）
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      if (e.isWaf) throw e; // WAF 拦截：立刻中止，绝不复读轰炸
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, backoffBase * (i + 1)));
    }
  }
}

async function pool(items, worker, size) {
  const results = []; let idx = 0;
  async function run() {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = { ok: true, value: await worker(items[my]) }; }
      catch (e) { results[my] = { ok: false, item: items[my], error: String(e.message || e), is404: !!e.is404, isPending: !!e.isPending }; }
    }
  }
  await Promise.all(Array.from({ length: size }, run));
  return results;
}

function defaultMeta() {
  return {
    market: 'CCER',
    marketName: '全国温室气体自愿减排交易市场（核证自愿减排量）',
    source: '全国温室气体自愿减排交易系统 ccer.com.cn「每日行情 / 数据查询」',
    sourceUrls: { listing: LIST_URL, daily: 'https://www.ccer.com.cn/wcm/ccer/data/YYYYMMDD-first.json' },
    fieldFormat: {
      date: 'YYYY-MM-DD 交易日期（主键；records 以此键名存放，按日期组织）',
      volume: 'number 当日成交量（吨）；零成交日为 0',
      turnover: 'number 当日成交额（元，2 位小数）',
      avgPrice: 'number|null 当日成交均价（元/吨）= 成交额 ÷ 成交量；零成交日为 null',
      source: 'string 数据来源：day-json=数据查询逐日明细 / detail=每日行情稿',
    },
    updatedAt: '',
    recordCount: 0,
    updateMethod: '增量追加：仅新增尚未存在的日期记录，历史记录不改动；累计值由展示层派生',
  };
}

async function main() {
  const forceFull = process.argv.includes('--full');
  console.log('拉取栏目列表 ...');
  let list;
  try {
    list = JSON.parse(await fetchText(LIST_URL, 5, 1500));
  } catch (e) {
    console.error('\n[警告] 无法获取栏目列表：官网可能限流 / WAF 拦截（' + (e.message || e) + '）。');
    console.error('        现有数据文件未被修改，限流解除后（通常几分钟~几小时）再运行本脚本即可。');
    if (fs.existsSync(DATA_FILE)) {
      try { const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); console.error('        当前本地已存 ' + Object.keys(j.records || {}).length + ' 个交易日。'); } catch (_) {}
    }
    process.exit(0); // 不覆盖、不崩溃
  }
  const dates = [...new Set(list.rows.map((r) => {
    const m = (r.title || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null;
  }).filter(Boolean))].sort();
  console.log(`列表去重后 ${dates.length} 个交易日（${dates[0]} ~ ${dates[dates.length - 1]}）`);

  // 载入已有 records（按日期键）
  let meta = defaultMeta();
  const existing = new Map();
  if (fs.existsSync(DATA_FILE) && !forceFull) {
    try {
      const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (j.meta) meta = Object.assign(meta, j.meta);
      Object.entries(j.records || {}).forEach(([d, v]) => existing.set(d, v));
      if (j.meta && j.meta.source) meta.source = j.meta.source;
    } catch (e) { console.warn('已有数据解析失败，全量重抓'); }
  }
  // 仅抓取：新日期（已有日期一律跳过 → 追加式，历史零改动）
  const todo = dates.filter((d) => !existing.has(d));
  console.log(`已有完好 ${dates.length - todo.length} 天，本次抓取 ${todo.length} 天`);

  let done = 0; const failed = []; const pending = [];
  const results = await pool(todo, async (date) => {
    await sleep(600 + Math.random() * 600); // 每日期之间随机间隔，进一步降低被封风险
    const ymd = date.replace(/-/g, '');
    let fromDetail = false;
    // 1) 逐日明细 JSON（主源）
    try {
      const txt = await fetchText(`https://www.ccer.com.cn/wcm/ccer/data/${ymd}-first.json`, 3, 600);
      let j = null; try { j = JSON.parse(txt); } catch (_) {}
      if (Array.isArray(j) && j.length > 0) {
        done++;
        if (done % 25 === 0) console.log(`  进度 ${done}/${todo.length}`);
        return Object.assign(parseDayJson(j, date), { source: 'day-json' });
      }
    } catch (e) {
      if (!e.is404 && !e.isWaf) console.log(`  [warn] ${date} day-json: ${e.message}，改走详情页`);
    }
    // 2) 详情页兜底
    const row = list.rows.find((r) => (r.title || '').includes(date.slice(0, 4) + '年' + (+date.slice(5, 7)) + '月' + (+date.slice(8, 10)) + '日'));
    if (!row || !(row.url || row.redirectUrl)) {
      const err = new Error('数据尚未发布（无明细JSON且无详情页）');
      err.isPending = true; throw err;
    }
    try {
      const html = await fetchText(BASE_HTML + (row.url || row.redirectUrl), 3, 600);
      done++;
      if (done % 25 === 0) console.log(`  进度 ${done}/${todo.length}`);
      fromDetail = true;
      return Object.assign(parseDetail(html, date), { source: 'detail' });
    } catch (e) {
      if (e.is404 || e.isWaf) {
        const err = new Error('数据尚未发布（详情页暂不可达）');
        err.isPending = true; throw err;
      }
      throw e;
    }
  }, CONCURRENCY);

  for (const r of results) {
    if (r.ok) { const v = r.value; existing.set(v.date, { volume: v.volume || 0, turnover: Math.round((v.turnover || 0) * 100) / 100, avgPrice: v.avgPrice == null ? null : v.avgPrice, source: v.source || 'day-json' }); }
    else if (r.isPending) pending.push(r.item);
    else failed.push(`${r.item}: ${r.error}`);
  }

  const records = {};
  [...existing.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([d, v]) => { records[d] = v; });
  meta.updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  meta.recordCount = Object.keys(records).length;
  const store = { meta, records };
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 1), 'utf8');
  console.log(`\n完成：共 ${Object.keys(records).length} 个交易日 -> ${DATA_FILE}（更新于 ${meta.updatedAt}）`);
  if (pending.length) {
    console.log(`待发布 ${pending.length} 天（链接已挂但数据未生成，下次更新自动重试）：${pending.slice(0, 20).join(', ')}${pending.length > 20 ? ' …' : ''}`);
  }
  if (failed.length) { console.log(`失败 ${failed.length} 条：`); failed.slice(0, 20).forEach((f) => console.log('  ' + f)); process.exitCode = 2; }

  // 自检：均价 = 成交额/成交量
  let pOk = 0, pBad = 0;
  Object.values(records).forEach((v) => {
    if (v.avgPrice != null && v.volume > 0 && v.turnover != null) {
      const calc = v.turnover / v.volume;
      if (Math.abs(calc - v.avgPrice) / v.avgPrice < 0.005) pOk++; else pBad++;
    }
  });
  console.log(`均价校验: 一致 ${pOk} / 偏差>0.5% ${pBad}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

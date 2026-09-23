/**
 * CCER 日度数据 → 按日期组织的数据仓 + 平台内置数据注入
 * ---------------------------------------------------------------------------
 * 作用：
 *  1) 读取源数据（优先 ccer-market-data.json；否则从 ccer-daily-data.json 迁移），
 *     产出「按日期(YYYY-MM-DD)为键」的数据仓 ccer-market-data.json；
 *  2) 若平台 HTML 中存在注入标记，则把同一份数据以内置常量 CCER_DAILY_DATA 注入，
 *     作为离线回退（与 CARBON_PRICE_DATA 的「内置 + fetch 更新」范式一致）。
 *
 * 数据结构（按日期组织 / 可追加）：
 *   {
 *     "meta": { 数据来源、字段格式、更新方式、更新时间、记录数 },
 *     "records": {
 *        "2024-01-22": { "volume":300, "turnover":27600, "avgPrice":92, "source":"day-json" },
 *        ...
 *     }
 *   }
 * 设计要点：累计成交量/累计成交额**不入库**，在展示层按日期升序逐项累加派生，
 * 因此「新增一个交易日」= 仅新增一条 records[新日期] 记录，历史记录零改动。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC_NEW = path.join(ROOT, 'ccer-market-data.json');     // 新仓（优先）
const SRC_LEGACY = path.join(ROOT, 'ccer-daily-data.json');   // 旧仓（迁移用）
const OUT = path.join(ROOT, 'ccer-market-data.json');
const PLATFORM = path.join(ROOT, 'carbon-learning-platform.html');
const START = '/*__CCER_BUILTIN_START__*/';
const END = '/*__CCER_BUILTIN_END__*/';

const SOURCE_LISTING = 'https://www.ccer.com.cn/wcm/ccer/data/2502lshq.json';  // 全量日报条目
const SOURCE_DAILY = 'https://www.ccer.com.cn/wcm/ccer/data/YYYYMMDD-first.json'; // 逐日成交明细

function loadSource() {
  if (fs.existsSync(SRC_NEW)) {
    const d = JSON.parse(fs.readFileSync(SRC_NEW, 'utf8'));
    if (d && d.records) return d; // 已是新结构
  }
  // 从旧仓迁移
  const leg = JSON.parse(fs.readFileSync(SRC_LEGACY, 'utf8'));
  const recs = {};
  (leg.daily || []).forEach((x) => {
    recs[x.date] = {
      volume: x.volume || 0,
      turnover: Math.round((x.turnover || 0) * 100) / 100,
      avgPrice: x.avgPrice == null ? null : x.avgPrice,
      source: x.source || 'day-json',
    };
  });
  return {
    meta: {
      market: 'CCER',
      marketName: '全国温室气体自愿减排交易市场（核证自愿减排量）',
      source: '全国温室气体自愿减排交易系统 ccer.com.cn「每日行情 / 数据查询」',
      sourceUrls: { listing: SOURCE_LISTING, daily: SOURCE_DAILY },
      fieldFormat: {
        date: 'YYYY-MM-DD 交易日期（主键；数据按日期组织，records 以此键名存放）',
        volume: 'number 当日成交量（吨）；零成交日为 0',
        turnover: 'number 当日成交额（元，2 位小数）',
        avgPrice: 'number|null 当日成交均价（元/吨）= 成交额 ÷ 成交量；零成交日为 null',
        source: 'string 数据来源：day-json=数据查询逐日明细 / detail=每日行情稿',
      },
      updatedAt: leg.updatedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
      recordCount: Object.keys(recs).length,
      updateMethod: '增量追加：仅新增尚未存在的日期记录，历史记录不改动；累计值由展示层派生',
    },
    records: recs,
  };
}

const data = loadSource();
// 规整 records（确保按日期键、字段齐全）
const recs = data.records || {};
const dates = Object.keys(recs).sort();
const clean = {};
dates.forEach((d) => {
  const r = recs[d];
  clean[d] = {
    volume: r.volume || 0,
    turnover: Math.round((r.turnover || 0) * 100) / 100,
    avgPrice: r.avgPrice == null ? null : r.avgPrice,
    source: r.source || 'day-json',
  };
});
data.records = clean;
data.meta.recordCount = dates.length;
data.meta.updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
fs.writeFileSync(OUT, JSON.stringify(data, null, 1), 'utf8');
console.log(`[1/2] 数据仓已写入 ${path.basename(OUT)}：${dates.length} 个交易日（${dates[0]} ~ ${dates[dates.length - 1]}）`);

// 注入平台内置（若标记存在）
let html = fs.readFileSync(PLATFORM, 'utf8');
const i = html.indexOf(START), j = html.indexOf(END);
if (i >= 0 && j >= 0) {
  const literal = 'var CCER_DAILY_DATA = ' + JSON.stringify(data) + ';';
  html = html.slice(0, i + START.length) + '\n' + literal + '\n' + html.slice(j);
  fs.writeFileSync(PLATFORM, html, 'utf8');
  console.log(`[2/2] 已注入平台内置 CCER_DAILY_DATA（${dates.length} 天）于 ${path.basename(PLATFORM)}`);
} else {
  console.log('[2/2] 平台未找到注入标记（' + START + '），跳过内置注入（稍后接入代码时再注入）。');
}

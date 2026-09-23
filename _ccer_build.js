/**
 * CCER 分析页面构建脚本（增量友好）
 * 读取 ccer-daily-data.json -> 以紧凑数组注入 ccer-market-analysis.html 的数据标记区
 * 日常更新流程: 1) node _ccer_scrape.js   (只抓新日期，追加进 json)
 *              2) node _ccer_build.js    (把最新 json 注入 HTML)
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'ccer-market-data.json');
const HTML_FILE = path.join(__dirname, 'ccer-market-analysis.html');
const START = '/*__CCER_DATA_START__*/';
const END = '/*__CCER_DATA_END__*/';

const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const records = store.records || {};
const daily = Object.keys(records).sort().map((d) => Object.assign({ date: d }, records[d]));
// 紧凑行: [日期, 成交量(吨), 成交额(元), 均价(元/吨|null)]，均价由页面按 成交额/成交量 复核
const rows = daily.map((d) => [d.date, d.volume || 0, +(d.turnover || 0).toFixed(2), d.avgPrice == null ? null : +d.avgPrice]);
const payload = {
  updatedAt: store.meta ? store.meta.updatedAt : store.updatedAt,
  source: store.meta ? store.meta.source : store.source,
  rows,
};
const json = JSON.stringify(payload);

let html = fs.readFileSync(HTML_FILE, 'utf8');
const i = html.indexOf(START), j = html.indexOf(END);
if (i < 0 || j < 0) { console.error('HTML 中找不到数据标记'); process.exit(1); }
html = html.slice(0, i + START.length) + '\nvar DATA = ' + json + ';\n' + html.slice(j);
fs.writeFileSync(HTML_FILE, html, 'utf8');
console.log(`已注入 ${rows.length} 个交易日（${rows[0][0]} ~ ${rows[rows.length - 1][0]}），数据更新时间 ${store.updatedAt}`);

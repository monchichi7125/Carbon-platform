/* 验证：整页主脚本语法编译 + 三个子页面（CCER / 配额 / 地方）在 mock DOM 下渲染、切换、导出、绘图 */
const fs = require('fs');
const vm = require('vm');
const ROOT = __dirname;
const html = fs.readFileSync(ROOT + '/carbon-learning-platform.html', 'utf8');

/* 1) 抽取所有内联 <script> 中体积最大者为主脚本 */
const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let m, blocks = [];
while ((m = scriptRe.exec(html))) { if (m[1].trim().length) blocks.push(m[1]); }
blocks.sort((a, b) => b.length - a.length);
const main = blocks[0];
console.log('[1] 内联脚本块数:', blocks.length, '| 主脚本字节:', main.length);

/* 截断 init：去掉末尾 loadState(); go(...) 的自动渲染，避免无头 DOM 报错 */
const cut = main.lastIndexOf('loadState();');
const code = cut > 0 ? main.slice(0, cut) : main;
console.log('[2] 是否成功去除自动渲染 init:', cut > 0);

/* 2) 编译检查 */
let compileErr = null;
try { new vm.Script(code, { filename: 'main' }); }
catch (e) { compileErr = e.message; }
console.log('[3] 主脚本语法编译:', compileErr ? '❌ ' + compileErr : '✅ 通过');
if (compileErr) process.exit(1);

/* 3) mock DOM + 运行 + 功能测试（在脚本同一作用域追加 harness） */
const els = {};
function mkEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', offsetWidth: 0,
    style: {}, dataset: {},
    classList: { toggle() { return false; }, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, setAttribute() {}, addEventListener() {},
    querySelectorAll() { return []; }, getAttribute() { return null; },
  };
}
function getEl(id) { if (!els[id]) els[id] = mkEl(id); return els[id]; }

const sandbox = {
  console,
  Math, JSON, Date, RegExp, Object, Array, Number, String, Boolean, parseInt, parseFloat, isNaN,
  document: {
    getElementById: getEl,
    querySelectorAll: () => [],
    createElement: () => mkEl(''),
    addEventListener() {},
    body: mkEl('body'),
    documentElement: mkEl('html'),
  },
  window: null,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Blob: function (parts) { this.size = (parts && parts[0] && parts[0].length) || 0; this.parts = parts; },
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} },
  setTimeout: () => {},
  clearTimeout: () => {},
  TextEncoder: (typeof TextEncoder !== 'undefined') ? TextEncoder : function(){},
  TextDecoder: (typeof TextDecoder !== 'undefined') ? TextDecoder : function(){},
  fetch: undefined,
  toast: (msg) => { sandbox.__toasts = (sandbox.__toasts || []); sandbox.__toasts.push(msg); },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);

const harness = `
var __T = { ok: false };
try {
  var c04i = DATA.modules.findIndex(function(x){ return x.priceData === true; });
  __T.c04index = c04i;
  var mod = DATA.modules[c04i];
  curMod = c04i;

  // 默认（ccer）
  var hc = priceDataHTML(mod);
  __T.ccer_hasSubNav = hc.includes('pd-subnav');
  __T.ccer_hasChart = hc.includes('id="ccerChart"');
  __T.ccer_hasTable2 = hc.includes('表二');
  __T.ccer_hasTable5 = hc.includes('表五');
  __T.ccer_hasTable9 = hc.includes('表九');
  __T.ccer_hasDailyTable = hc.includes('表七');

  // 配额（cea）
  pdSub = 'cea';
  var hcea = pdSubHTML('cea', mod);
  __T.cea_hasTable1 = hcea.includes('表一');
  __T.cea_hasTable4 = hcea.includes('表四');
  __T.cea_hasTable8 = hcea.includes('表八');
  __T.cea_noChart = !hcea.includes('id="ccerChart"');
  __T.cea_exportBtn = hcea.includes("exportPdSubCSV('cea')");

  // 地方（pilot）
  pdSub = 'pilot';
  var hp = pdSubHTML('pilot', mod);
  __T.pilot_hasTable3 = hp.includes('表三');
  __T.pilot_hasTable6 = hp.includes('表六');
  __T.pilot_hasTable7 = hp.includes('表七');
  __T.pilot_exportBtn = hp.includes("exportPdSubCSV('pilot')");

  // 切换函数 pdSetSub
  pdSetSub('ccer');
  var bodyCcer = document.getElementById('pdSubBody').innerHTML || '';
  __T.setCcer_bodyChart = bodyCcer.includes('id="ccerChart"');
  var chartHtml = document.getElementById('ccerChart').innerHTML || '';
  __T.chart_svg = chartHtml.includes('<svg');
  __T.chart_rect = chartHtml.includes('<rect');
  __T.chart_circle = chartHtml.includes('<circle');
  pdSetSub('cea');
  var bodyCea = document.getElementById('pdSubBody').innerHTML || '';
  __T.setCea_bodyNoChart = !bodyCea.includes('id="ccerChart"');
  pdSetSub('pilot');
  var bodyPilot = document.getElementById('pdSubBody').innerHTML || '';
  __T.setPilot_bodyNoChart = !bodyPilot.includes('id="ccerChart"');
  // national 父按钮应从 pilot 切回 ccer
  pdSetSub('national');
  __T.nationalFromPilot_isCcer = (pdSub === 'ccer');

  // 分组导出
  var cap = null;
  dlFile = function(b, n){ cap = { n: n, size: b.size }; };
  exportPdSubCSV('cea'); __T.ceaCSV = cap && cap.n;
  exportPdSubCSV('pilot'); __T.pilotCSV = cap && cap.n;
  exportPdSubCSV('ccer'); __T.ccerCSV = cap && cap.n;
  exportPriceCSV('__ALL__'); __T.allCSV = cap && cap.n;
  exportPdSubXLSX('cea'); __T.ceaXLSX = cap && cap.n;
  exportPdSubXLSX('pilot'); __T.pilotXLSX = cap && cap.n;

  __T.ok = true;
} catch (e) {
  __T.err = (e && e.stack) || String(e);
}
`;

let runErr = null;
try { vm.runInContext(code + '\n' + harness, sandbox, { filename: 'main+harness' }); }
catch (e) { runErr = (e && e.stack) || String(e); }

if (runErr) { console.log('[4] ❌ 脚本运行抛错:', runErr); process.exit(1); }
const T = sandbox.__T;
if (!T) { console.log('[4] ❌ harness 未产出结果（可能是 const 作用域问题）'); process.exit(1); }
if (T.err) { console.log('[4] ❌ 功能测试抛错:', T.err); process.exit(1); }

console.log('[4] c04 模块索引:', T.c04index);
console.log('[5] CCER 子页: 子导航', T.ccer_hasSubNav, '| 图表', T.ccer_hasChart,
  '| 表二/表五/表九/表七', T.ccer_hasTable2, T.ccer_hasTable5, T.ccer_hasTable9, T.ccer_hasDailyTable);
console.log('[6] 配额子页: 表一/表四/表八', T.cea_hasTable1, T.cea_hasTable4, T.cea_hasTable8,
  '| 无图表', T.cea_noChart, '| 导出按钮', T.cea_exportBtn);
console.log('[7] 地方子页: 表三/表六/表七', T.pilot_hasTable3, T.pilot_hasTable6, T.pilot_hasTable7,
  '| 导出按钮', T.pilot_exportBtn);
console.log('[8] 切换 pdSetSub: ccer 主体含图', T.setCcer_bodyChart, '| cea 主体无图', T.setCea_bodyNoChart,
  '| pilot 主体无图', T.setPilot_bodyNoChart, '| national←pilot 回到 ccer', T.nationalFromPilot_isCcer);
console.log('[9] 图表 SVG:', T.chart_svg, '| rect(柱):', T.chart_rect, '| circle(线点):', T.chart_circle);
console.log('[10] 导出文件名: cea', T.ceaCSV, '| pilot', T.pilotCSV, '| ccer', T.ccerCSV,
  '| 全部', T.allCSV, '| cea XLSX', T.ceaXLSX, '| pilot XLSX', T.pilotXLSX);

const checks = [
  T.ccer_hasSubNav, T.ccer_hasChart, T.ccer_hasTable2, T.ccer_hasTable5, T.ccer_hasTable9, T.ccer_hasDailyTable,
  T.cea_hasTable1, T.cea_hasTable4, T.cea_hasTable8, T.cea_noChart, T.cea_exportBtn,
  T.pilot_hasTable3, T.pilot_hasTable6, T.pilot_hasTable7, T.pilot_exportBtn,
  T.setCcer_bodyChart, T.setCea_bodyNoChart, T.setPilot_bodyNoChart, T.nationalFromPilot_isCcer,
  T.chart_svg, T.chart_rect, T.chart_circle,
  /碳价_cea/.test(T.ceaCSV||''), /碳价_pilot/.test(T.pilotCSV||''), /碳价_ccer/.test(T.ccerCSV||''),
  /碳价数据_分组/.test(T.ceaXLSX||''),
];
const failed = checks.filter(Boolean).length;
console.log('\n[结果] 通过检查项:', failed, '/', checks.length, failed === checks.length ? '✅ 全部通过' : '❌ 有失败');
process.exit(failed === checks.length ? 0 : 1);

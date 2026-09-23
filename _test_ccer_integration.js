/* 验证：1) 整页 <script> 语法可编译；2) CCER 块在 mock DOM 下可渲染 */
const fs = require('fs');
const vm = require('vm');
const ROOT = __dirname;
const html = fs.readFileSync(ROOT + '/carbon-learning-platform.html', 'utf8');

/* ---- 1) 语法编译整页所有 script ---- */
const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let m, idx = 0, compileErr = null;
while ((m = scriptRe.exec(html))) {
  idx++;
  try { new vm.Script(m[1], { filename: 'page-script-' + idx }); }
  catch (e) { compileErr = { idx, msg: e.message }; break; }
}
console.log('[1] script 块数量:', idx, '| 语法编译:', compileErr ? '❌ ' + JSON.stringify(compileErr) : '✅ 全部通过');

/* ---- 2) 抽取 CCER 集成块做功能测试 ---- */
const START = '/* ==== CCER INTEGRATION START ==== */';
const END = '/* ==== CCER INTEGRATION END ==== */';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0) { console.log('[2] 未找到 CCER 集成块标记'); process.exit(1); }
const ccerCode = html.slice(a + START.length, b);

// 内置数据
const data = JSON.parse(fs.readFileSync(ROOT + '/ccer-market-data.json', 'utf8'));

// 最小 mock DOM
const store = {};
function el(id){ if(!store[id]) store[id] = { id, _html:'' , set innerHTML(v){this._html=v;}, get innerHTML(){return this._html;}, style:{}, dataset:{}, classList:{toggle(){return false;}}, textContent:'' }; return store[id]; }
const sandbox = {
  console,
  window: {},
  document: {
    getElementById: el,
    createElement: () => ({ style:{}, setAttribute(){}, appendChild(){}, click(){}, rel:'' }),
    body: { appendChild(){}, removeChild(){} },
    querySelectorAll: () => [],
    addEventListener(){},
  },
  Blob: typeof Blob !== 'undefined' ? Blob : function(){},
  URL: { createObjectURL(){return 'blob:mock';}, revokeObjectURL(){} },
  fetch: undefined,
  setTimeout: () => {},
  toast: (msg) => { sandbox.__toasts = (sandbox.__toasts||[]); sandbox.__toasts.push(msg); },
  togglePD: () => {},
  switchModStage: () => {},
  CCER_DAILY_DATA: data,
};
sandbox.window = sandbox; // 让 window.CCER_DAILY_DATA 可读
vm.createContext(sandbox);

let funcErr = null;
try {
  vm.runInContext(ccerCode, sandbox, { filename: 'ccer-block' });
  // 功能调用
  const dv = sandbox.ccerDerived();
  const htmlOut = sandbox.ccerHTML();
  sandbox.ccerRenderChart('month');
  sandbox.ccerRenderChart('day');

  console.log('[2a] ccerDerived: 日度', dv.daily.length, '条 | 月度', dv.monthly.length, '组');
  const last = dv.daily[dv.daily.length-1];
  const f = dv.daily[0];
  console.log('[2b] 首条累计:', f.cumVol, f.cumTurn, '| 末条累计:', last.cumVol, last.cumTurn,
              '| 末条均价:', last.avgPrice, '| 末条成交量:', last.volume);
  console.log('[2c] ccerHTML 长度:', htmlOut.length, '| 含「ccerChart」:', htmlOut.includes('id="ccerChart"'),
              '| 含「表六」:', htmlOut.includes('表六'), '| 含「表七」:', htmlOut.includes('表七'),
              '| 含「同步方式」:', htmlOut.includes('同步方式'));
  console.log('[2d] 月度图 SVG 渲染字节:', (store['ccerChart'] && store['ccerChart']._html.length) || 0,
              '| 含 <svg:', (store['ccerChart']._html||'').includes('<svg'),
              '| 含 <rect(柱):', (store['ccerChart']._html||'').includes('<rect'),
              '| 含 <circle(线点):', (store['ccerChart']._html||'').includes('<circle'));

  // CSV 导出（替换 dlFile 捕获内容）
  let captured = null;
  sandbox.dlFile = (blob, name) => { captured = { name, size: blob.size }; };
  sandbox.exportCcerCSV('day');
  sandbox.exportCcerCSV('month');
  console.log('[2e] CSV 导出调用未抛错；日度/月度导出触发下载:', !!captured, captured && captured.name);

  // 无数据回退
  const saved = sandbox.CCER_DAILY_DATA; sandbox.CCER_DAILY_DATA = { meta:{}, records:{} };
  const fallback = sandbox.ccerHTML();
  console.log('[2f] 无数据时回退提示:', fallback.includes('尚未接入'));
  sandbox.CCER_DAILY_DATA = saved;
} catch (e) {
  funcErr = e;
}
if (funcErr) console.log('[2] ❌ 功能测试抛错:', funcErr && funcErr.stack || funcErr);
else console.log('[2] ✅ CCER 功能渲染全部通过');

const fs=require('fs');
const vm=require('vm');
const path=require('path');

// 1) standalone calculator as ground truth
const calc=require('./_ccer_annual.js');
const store=JSON.parse(fs.readFileSync('ccer-market-data.json','utf8'));
const daily=calc.recordsToDaily(store.records);
const annualGT=calc.computeCcerAnnualFromDaily(daily);

// 2) load platform main script
const html=fs.readFileSync('carbon-learning-platform.html','utf8');
const blocks=html.match(/<script>([\s\S]*?)<\/script>/g)||[];
let code=blocks.map(s=>s.replace(/<\/?script>/g,'')).sort((a,b)=>b.length-a.length)[0];

function makeEl(tag){
  const el={tag,children:[],attrs:{},_html:'',_text:'',style:{}};
  el.appendChild=c=>{el.children.push(c);return c;};
  el.setAttribute=(k,v)=>{el.attrs[k]=v;};
  el.getAttribute=k=>el.attrs[k];
  Object.defineProperty(el,'innerHTML',{get(){return el._html;},set(v){el._html=String(v);}});
  Object.defineProperty(el,'textContent',{get(){return el._text;},set(v){el._text=String(v);}});
  el.addEventListener=()=>{};el.removeEventListener=()=>{};el.click=()=>{};
  el.querySelector=()=>null;el.querySelectorAll=()=>[];
  el.classList={add(){},remove(){},toggle(){},contains(){return false;}};
  return el;
}
const store2={};
const doc={
  getElementById:id=>{ if(!store2[id]) store2[id]=makeEl('div'); return store2[id]; },
  querySelector:()=>null, querySelectorAll:()=>[],
  createElement:makeEl, addEventListener:()=>{}, body:makeEl('body')
};
const sandbox={
  window:{location:{href:''},addEventListener:()=>{},open:()=>{},scrollTo:()=>{}},
  document:doc, console,
  setTimeout:()=>{}, clearTimeout:()=>{}, setInterval:()=>{}, clearInterval:()=>{},
  fetch:undefined, location:{href:''},
  TextEncoder, TextDecoder, Blob:function(){}, URL:{createObjectURL:()=>''},
  navigator:{userAgent:'node'}
};
sandbox.window.document=doc;
vm.createContext(sandbox);
vm.runInContext(code,sandbox);

// render CCER sub-page HTML directly (annual panel lives inside ccerHTML)
const h=sandbox.ccerHTML();

// extract the 年度汇总 table (the one with header 年份 ... 均价同比)
function extractTableByHeader(htmlStr, headerText){
  const re=/<table class="price-tbl">([\s\S]*?)<\/table>/g; let x;
  while((x=re.exec(htmlStr))){
    if(x[1].includes(headerText)) return x[1];
  }
  return null;
}
const t=extractTableByHeader(h,'年份');
let pass=true;
if(!t){ console.log('FAIL: 年度汇总 table not found'); pass=false; }
else {
  const rows=[...t.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(r=>r[1]);
  // header is first row with <th>; data rows have <td
  const dataRows=rows.filter(r=>r.includes('<td')).map(r=>{
    const tds=[...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>{
      let v=m[1].replace(/&nbsp;/g,' ').trim();
      return v;
    });
    return tds;
  });
  console.log('年度汇总 rows found:', dataRows.length);
  dataRows.forEach((row,i)=>{
    const yr=row[0];
    const gt=annualGT.find(a=>String(a.year)===yr);
    if(!gt){ console.log('FAIL: year',yr,'not in ground truth'); pass=false; return; }
    const gotTradeDays=row[1];
    const gotVol=row[2].replace(/,/g,'');
    const gotTurn=row[3].replace(/,/g,'');
    const gotW=row[4];
    const gotMax=row[5];
    const gotMin=row[6];
    const gotYoy=row[7];
    const ok = gotTradeDays===String(gt.tradeDays)
      && gotVol===String(gt.totalVolume)
      && Math.abs(Number(gotTurn)-gt.totalTurnover)<0.01
      && gotW===gt.weightedAvgPrice.toFixed(2)
      && gotMax===gt.maxAvgPrice.toFixed(2)
      && gotMin===gt.minAvgPrice.toFixed(2)
      && (gt.avgYoy==null ? gotYoy==='—' : gotYoy===(gt.avgYoy*100).toFixed(2)+'%');
    console.log(`  ${yr}: tradeDays=${gotTradeDays}/${gt.tradeDays} vol=${gotVol}/${gt.totalVolume} w=${gotW}/${gt.weightedAvgPrice.toFixed(2)} yoy=${gotYoy} -> ${ok?'OK':'FAIL'}`);
    if(!ok) pass=false;
  });
}

// 3) verify exportCcerCSV('annual') triggers a download (override dlFile to capture)
let exportedName=null;
sandbox.dlFile=function(blob,name){ exportedName=name; };
sandbox.exportCcerCSV('annual');
console.log('annual CSV export name:', exportedName, exportedName && exportedName.indexOf('CCER_年度')===0 ? '(OK)':'(FAIL)');
if(!exportedName || exportedName.indexOf('CCER_年度')!==0) pass=false;

console.log('\nPASS:', pass);
process.exit(pass?0:1);

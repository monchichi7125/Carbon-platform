/**
 * CCER 年度汇总计算（严格基于每日行情明细逐条汇总）
 * --------------------------------------------------------------------------
 * 设计原则（与需求一致）：
 *  1. 数据严格来自每日行情明细（records[YYYY-MM-DD] = {volume, turnover, avgPrice, source}）。
 *  2. 所有年度指标均由明细“逐条累加 / 统计”得出，不做任何推估、插值或预测。
 *  3. 零成交日（volume===0，avgPrice===null）天然只贡献 0，并被排除在“交易日数 / 日均价极值”之外。
 *  4. 年度加权均价 = Σ成交额 ÷ Σ成交量（即成交量加权均值），由真实总额相除得到，非对日均价再平均。
 *  5. 同比（yoy）仅基于真实计算出的相邻年度加权均价做比值，属于结果对比而非预测。
 *
 * 用法：
 *   node _ccer_annual.js                 // 读取 ccer-market-data.json，打印并写出 ccer-annual.json
 *   node _ccer_annual.js --no-write      // 仅打印，不写出文件
 */

'use strict';
const fs = require('fs');
const path = require('path');

/**
 * 核心：由“每日明细数组”计算年度汇总。
 * @param {Array<{date:string, volume:number, turnover:number, avgPrice:number|null}>} daily
 *        已按 date 升序的每日明细（可由 records 转换，或平台内 dv.daily）。
 * @returns {Array} 按年份升序的年度汇总数组。
 */
function computeCcerAnnualFromDaily(daily) {
  // 防御：确保升序
  const arr = daily.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const byYear = Object.create(null);
  for (const d of arr) {
    const year = String(d.date).slice(0, 4);
    if (!byYear[year]) {
      byYear[year] = {
        year,
        recordDays: 0,     // 该年收录的明细条数（含零成交日）
        tradeDays: 0,      // 实际有成交的交易日数（volume > 0）
        totalVolume: 0,    // 累计成交量（吨）
        totalTurnover: 0,  // 累计成交额（元）
        _minAvg: Infinity, // 年内最低“日成交均价”（仅交易日）
        _maxAvg: -Infinity,// 年内最高“日成交均价”（仅交易日）
        firstTradeDate: null,
        lastTradeDate: null,
        firstTradeAvg: null,
        lastTradeAvg: null,
      };
    }
    const y = byYear[year];
    y.recordDays += 1;

    const vol = (typeof d.volume === 'number' && isFinite(d.volume)) ? d.volume : 0;
    const turn = (typeof d.turnover === 'number' && isFinite(d.turnover)) ? d.turnover : 0;
    // 逐条累加（零成交日 vol/turn 均为 0，不影响总额）
    y.totalVolume += vol;
    y.totalTurnover += turn;

    if (vol > 0) {
      y.tradeDays += 1;
      if (y.firstTradeDate === null) {
        y.firstTradeDate = d.date;
        y.firstTradeAvg = d.avgPrice;
      }
      y.lastTradeDate = d.date;
      y.lastTradeAvg = d.avgPrice;
      if (d.avgPrice != null && isFinite(d.avgPrice)) {
        if (d.avgPrice < y._minAvg) y._minAvg = d.avgPrice;
        if (d.avgPrice > y._maxAvg) y._maxAvg = d.avgPrice;
      }
    }
  }

  const years = Object.keys(byYear).sort();
  const out = years.map((year) => {
    const y = byYear[year];
    const weighted = y.totalVolume > 0 ? y.totalTurnover / y.totalVolume : null; // 真实加权均价
    return {
      year,
      recordDays: y.recordDays,
      tradeDays: y.tradeDays,
      totalVolume: y.totalVolume,
      totalTurnover: Math.round(y.totalTurnover * 100) / 100,
      weightedAvgPrice: weighted == null ? null : Math.round(weighted * 100) / 100,
      minAvgPrice: y._minAvg === Infinity ? null : y._minAvg,
      maxAvgPrice: y._maxAvg === -Infinity ? null : y._maxAvg,
      firstTradeDate: y.firstTradeDate,
      lastTradeDate: y.lastTradeDate,
      firstTradeAvgPrice: y.firstTradeAvg,
      lastTradeAvgPrice: y.lastTradeAvg,
    };
  });

  // 同比（基于真实加权均价比值的对比，非预测）
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].weightedAvgPrice;
    const cur = out[i].weightedAvgPrice;
    out[i].avgYoy = (prev && prev !== 0 && cur != null)
      ? Math.round((cur / prev - 1) * 10000) / 10000
      : null;
  }
  return out;
}

/** 将 records（日期为键）转为每日明细数组 */
function recordsToDaily(records) {
  return Object.keys(records).sort().map((date) => {
    const r = records[date];
    return {
      date,
      volume: r.volume,
      turnover: r.turnover,
      avgPrice: r.avgPrice,
      source: r.source,
    };
  });
}

/* ----------------------------- CLI ----------------------------- */
if (require.main === module) {
  const noWrite = process.argv.includes('--no-write');
  const dataPath = path.join(__dirname, 'ccer-market-data.json');
  if (!fs.existsSync(dataPath)) {
    console.error('未找到 ccer-market-data.json，无法计算年度汇总。');
    process.exit(1);
  }
  const store = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const daily = recordsToDaily(store.records);
  const annual = computeCcerAnnualFromDaily(daily);

  // 打印
  console.log('CCER 年度汇总（严格基于每日明细逐条统计，无推估/插值/预测）');
  console.log('数据区间：', daily[0].date, '~', daily[daily.length - 1].date,
              '｜ 明细条数：', daily.length);
  const pad = (s, n) => String(s == null ? '—' : s).padStart(n);
  const fmtN = (n) => (n == null ? '—' : n.toLocaleString('zh-CN'));
  console.log(
    ['年份', '交易日', '成交量(吨)', '成交额(元)', '加权均价', '最高日均价', '最低日均价', '均价同比'].join('\t')
  );
  for (const a of annual) {
    console.log([
      a.year,
      pad(a.tradeDays, 4),
      pad(fmtN(a.totalVolume), 12),
      pad(fmtN(a.totalTurnover), 16),
      pad(a.weightedAvgPrice == null ? '—' : a.weightedAvgPrice.toFixed(2), 9),
      pad(a.maxAvgPrice == null ? '—' : a.maxAvgPrice.toFixed(2), 9),
      pad(a.minAvgPrice == null ? '—' : a.minAvgPrice.toFixed(2), 9),
      pad(a.avgYoy == null ? '—' : (a.avgYoy * 100).toFixed(2) + '%', 8),
    ].join('\t'));
  }

  if (!noWrite) {
    const outPath = path.join(__dirname, 'ccer-annual.json');
    const partialYears = annual.filter((a) => a.recordDays <= 1).map((a) => a.year);
    const payload = {
      meta: {
        description: 'CCER 年度汇总（由 ccer-market-data.json 每日明细逐条累加/统计得出，非推估/插值/预测）',
        source: 'ccer-market-data.json',
        method: 'Σ成交量=Σvolume；Σ成交额=Σturnover；加权均价=Σturnover÷Σvolume；极值取自交易日 avgPrice；同比为相邻年度加权均价比值',
        derived: true,
        detailCount: daily.length,
        computedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        notes: partialYears.length
          ? ['以下年份官方数据查询源仅提供 ≤1 条明细，年度汇总仅代表现有明细：' + partialYears.join('、') + '。']
          : [],
      },
      annual: annual,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log('\n已写出：', outPath);
  }
}

module.exports = { computeCcerAnnualFromDaily, recordsToDaily };

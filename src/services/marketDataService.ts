import dayjs from 'dayjs';
import { requestTushareDaily, requestTushareTradeCal } from '../clients/tushareClient';
import { MARKET_ANALYST_LOOKBACK_DAYS, TUSHARE_TOKEN } from '../config/env';
import { runPythonScript } from '../utils/pythonBridge';

export interface MarketData {
  price: number;
  ma20: number;
  date: string;
  change: number;
  changePct: number;
  ma5: number;
  ma10: number;
  ma60: number;
  macd: { dif: number; dea: number; macd: number };
  rsi6: number;
  rsi12: number;
  rsi24: number;
  rsi14: number;
  boll: { upper: number; mid: number; lower: number; positionPct: number };
  history: MarketHistoryPoint[];
  report: string;
}

interface DailyItem {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  pre_close: number;
  change: number;
  pct_chg: number;
  vol: number;
  amount: number;
}

export interface MarketHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  pre_close?: number;
  volume: number;
  amount: number;
  ma5?: number;
  ma10?: number;
  ma20?: number;
  ma60?: number;
  macd_dif?: number;
  macd_dea?: number;
  macd?: number;
  rsi6?: number;
  rsi12?: number;
  rsi24?: number;
  rsi14?: number;
  boll_mid?: number;
  boll_upper?: number;
  boll_lower?: number;
}

export async function fetchMarketData(symbol: string, date: string): Promise<MarketData> {
  const tsCode = toTsCode(symbol);
  const targetDate = dayjs(date).format('YYYYMMDD');
  const { startDate, endDate } = await resolveTradingRange(targetDate, MARKET_ANALYST_LOOKBACK_DAYS);

  let records: DailyItem[] | null = null;
  let tushareError: Error | null = null;

  if (TUSHARE_TOKEN) {
    try {
      records = await fetchFromTushare(tsCode, startDate, endDate);
    } catch (err) {
      tushareError = err as Error;
    }
  } else {
    tushareError = new Error('缺少 TUSHARE_TOKEN 环境变量');
  }

  if (!records) {
    try {
      records = await fetchFromAkshare(symbol, startDate, endDate);
    } catch (pyErr) {
      const reason = tushareError ? `Tushare 失败: ${tushareError.message}；` : '';
      throw new Error(`${reason}Akshare 兜底也失败: ${(pyErr as Error).message}`);
    }
  }

  if (!records.length) {
    throw new Error(`Tushare 无行情数据，ts_code=${tsCode} start=${startDate} end=${endDate}`);
  }

  records.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const targetRecord = [...records].filter((r) => r.trade_date <= endDate).pop();

  if (!targetRecord) {
    throw new Error(`未找到 ${date} 及之前的交易日收盘价，ts_code=${tsCode}`);
  }

  const last20 = records.filter((r) => r.trade_date <= targetRecord.trade_date).slice(-20);
  if (!last20.length) {
    throw new Error(`近 20 日无足够收盘价数据，ts_code=${tsCode}`);
  }

  const history = enrichIndicators(records.map(mapToHistoryPoint));
  const latest = history[history.length - 1];
  if (!latest.ma20) {
    throw new Error('行情指标计算异常，缺少 MA20');
  }
  const prevClose = history.length > 1 ? history[history.length - 2].close : latest.pre_close ?? latest.close;
  const change = latest.close - prevClose;

  return {
    price: latest.close,
    ma20: latest.ma20,
    date: formatTradeDate(targetRecord.trade_date),
    change,
    changePct: prevClose !== 0 ? (change / prevClose) * 100 : 0,
    ma5: latest.ma5 ?? latest.close,
    ma10: latest.ma10 ?? latest.close,
    ma60: latest.ma60 ?? latest.close,
    macd: { dif: latest.macd_dif ?? 0, dea: latest.macd_dea ?? 0, macd: latest.macd ?? 0 },
    rsi6: latest.rsi6 ?? 0,
    rsi12: latest.rsi12 ?? 0,
    rsi24: latest.rsi24 ?? 0,
    rsi14: latest.rsi14 ?? 0,
    boll: {
      upper: latest.boll_upper ?? latest.close,
      mid: latest.boll_mid ?? latest.close,
      lower: latest.boll_lower ?? latest.close,
      positionPct:
        latest.boll_upper && latest.boll_lower
          ? ((latest.close - latest.boll_lower) / (latest.boll_upper - latest.boll_lower)) * 100
          : 50
    },
    history,
    report: buildMarketReportText(symbol, history)
  };
}

function toTsCode(symbol: string): string {
  // 6 开头沪市，其他默认深市
  return symbol.startsWith('6') ? `${symbol}.SH` : `${symbol}.SZ`;
}

async function fetchFromTushare(tsCode: string, startDate: string, endDate: string): Promise<DailyItem[]> {
  const { fields, items } = await requestTushareDaily(TUSHARE_TOKEN, tsCode, startDate, endDate);
  const tradeDateIdx = fields.indexOf('trade_date');
  const openIdx = fields.indexOf('open');
  const highIdx = fields.indexOf('high');
  const lowIdx = fields.indexOf('low');
  const closeIdx = fields.indexOf('close');
  const preCloseIdx = fields.indexOf('pre_close');
  const changeIdx = fields.indexOf('change');
  const pctChgIdx = fields.indexOf('pct_chg');
  const volIdx = fields.indexOf('vol');
  const amountIdx = fields.indexOf('amount');

  if (
    tradeDateIdx === -1 ||
    closeIdx === -1 ||
    openIdx === -1 ||
    highIdx === -1 ||
    lowIdx === -1 ||
    preCloseIdx === -1
  ) {
    throw new Error('Tushare 返回缺少关键行情字段');
  }

  const parsed: DailyItem[] = items
    .map((row) => ({
      trade_date: String(row[tradeDateIdx]),
      open: Number(row[openIdx]),
      high: Number(row[highIdx]),
      low: Number(row[lowIdx]),
      close: Number(row[closeIdx]),
      pre_close: Number(row[preCloseIdx]),
      change: Number(row[changeIdx] ?? row[closeIdx] - row[preCloseIdx]),
      pct_chg: Number(row[pctChgIdx] ?? 0),
      vol: Number(row[volIdx] ?? 0),
      amount: Number(row[amountIdx] ?? 0)
    }))
    .filter(
      (r) =>
        r.trade_date &&
        Number.isFinite(r.open) &&
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close)
    );

  return parsed;
}

async function fetchFromAkshare(symbol: string, startDate: string, endDate: string): Promise<DailyItem[]> {
  const payload = { symbol, start_date: startDate, end_date: endDate };
  const response = await runPythonScript<{ items: DailyItem[] }>('fetch_market_data.py', payload);
  if (!response?.items?.length) {
    throw new Error('Akshare 返回空数据');
  }
  return response.items.map((item) => ({
    ...item,
    trade_date: item.trade_date,
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close: Number(item.close),
    pre_close: Number(item.pre_close ?? item.close),
    change: Number(item.change ?? item.close - (item.pre_close ?? item.close)),
    pct_chg: Number(item.pct_chg ?? 0),
    vol: Number(item.vol ?? 0),
    amount: Number(item.amount ?? 0)
  }));
}

function formatTradeDate(raw: string): string {
  return dayjs(raw, 'YYYYMMDD').format('YYYY-MM-DD');
}

async function resolveTradingRange(targetDate: string, lookbackDays: number): Promise<{ startDate: string; endDate: string }> {
  // 优先调用交易日历，确保遇到节假日时使用最近交易日
  const calStart = dayjs(targetDate).subtract(lookbackDays + 20, 'day').format('YYYYMMDD');
  const calEnd = dayjs(targetDate).add(1, 'day').format('YYYYMMDD');

  try {
    const { fields, items } = await requestTushareTradeCal(TUSHARE_TOKEN, calStart, calEnd);
    const calIdx = fields.indexOf('cal_date');
    const isOpenIdx = fields.indexOf('is_open');
    if (calIdx === -1 || isOpenIdx === -1) {
      throw new Error('交易日历缺少字段');
    }
    const openDates = items
      .map((row) => ({ date: String(row[calIdx]), isOpen: Number(row[isOpenIdx]) === 1 }))
      .filter((d) => d.isOpen)
      .map((d) => d.date)
      .sort();

    const end = findLastLE(openDates, targetDate) ?? openDates[openDates.length - 1];
    const endIndex = openDates.findIndex((d) => d === end);
    const startIndex = Math.max(0, endIndex - lookbackDays + 1);
    const start = openDates[startIndex] ?? calStart;

    return { startDate: start, endDate: end };
  } catch {
    // 回退：按自然日回溯
    const fallbackEnd = targetDate;
    const fallbackStart = dayjs(targetDate).subtract(lookbackDays + 10, 'day').format('YYYYMMDD');
    return { startDate: fallbackStart, endDate: fallbackEnd };
  }
}

function findLastLE(dates: string[], target: string): string | undefined {
  const sorted = [...dates].sort();
  let res: string | undefined;
  for (const d of sorted) {
    if (d <= target) res = d;
    else break;
  }
  return res;
}

function mapToHistoryPoint(item: DailyItem): MarketHistoryPoint {
  return {
    date: formatTradeDate(item.trade_date),
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    pre_close: item.pre_close,
    volume: item.vol,
    amount: item.amount
  };
}

function enrichIndicators(history: MarketHistoryPoint[]): MarketHistoryPoint[] {
  const closes = history.map((h) => h.close);
  const ma5Series = movingAverage(closes, 5);
  const ma10Series = movingAverage(closes, 10);
  const ma20Series = movingAverage(closes, 20);
  const ma60Series = movingAverage(closes, 60);

  const macdSeries = computeMACD(closes);
  const rsi6Series = computeRSI(closes, 6, true);
  const rsi12Series = computeRSI(closes, 12, true);
  const rsi24Series = computeRSI(closes, 24, true);
  const rsi14Series = computeRSI(closes, 14, false);
  const bollSeries = computeBOLL(closes, 20);

  return history.map((h, idx) => ({
    ...h,
    ma5: ma5Series[idx],
    ma10: ma10Series[idx],
    ma20: ma20Series[idx],
    ma60: ma60Series[idx],
    macd_dif: macdSeries.dif[idx],
    macd_dea: macdSeries.dea[idx],
    macd: macdSeries.macd[idx],
    rsi6: rsi6Series[idx],
    rsi12: rsi12Series[idx],
    rsi24: rsi24Series[idx],
    rsi14: rsi14Series[idx],
    boll_mid: bollSeries.mid[idx],
    boll_upper: bollSeries.upper[idx],
    boll_lower: bollSeries.lower[idx]
  }));
}

function movingAverage(series: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < series.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const slice = series.slice(start, i + 1);
    const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
    result.push(avg);
  }
  return result;
}

function computeEMA(series: number[], span: number): number[] {
  if (!series.length) return [];
  const result: number[] = [];
  const alpha = 2 / (span + 1);
  series.forEach((value, idx) => {
    if (idx === 0) {
      result.push(value);
    } else {
      result.push(value * alpha + result[idx - 1] * (1 - alpha));
    }
  });
  return result;
}

function computeMACD(series: number[]): { dif: number[]; dea: number[]; macd: number[] } {
  const ema12 = computeEMA(series, 12);
  const ema26 = computeEMA(series, 26);
  const dif = ema12.map((v, i) => v - (ema26[i] ?? v));
  const dea = computeEMA(dif, 9);
  const macd = dif.map((v, i) => (v - (dea[i] ?? v)) * 2);
  return { dif, dea, macd };
}

function computeRSI(series: number[], period: number, chinaStyle: boolean): number[] {
  if (series.length === 0) return [];
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < series.length; i += 1) {
    const diff = series[i] - series[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  if (chinaStyle) {
    const avgGain = computeEMA(gains, period);
    const avgLoss = computeEMA(losses, period);
    return avgGain.map((g, i) => {
      const l = avgLoss[i] ?? 0;
      if (l === 0) return 100;
      const rs = g / l;
      return 100 - 100 / (1 + rs);
    });
  }

  const result: number[] = [];
  for (let i = 0; i < series.length; i += 1) {
    const start = Math.max(0, i - period + 1);
    const sliceG = gains.slice(start, i + 1);
    const sliceL = losses.slice(start, i + 1);
    const avgG = sliceG.reduce((s, v) => s + v, 0) / sliceG.length;
    const avgL = sliceL.reduce((s, v) => s + v, 0) / sliceL.length;
    if (avgL === 0) {
      result.push(100);
    } else {
      const rs = avgG / avgL;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

function computeBOLL(series: number[], window: number): { upper: number[]; mid: number[]; lower: number[] } {
  const mid: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < series.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const slice = series.slice(start, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    mid.push(mean);
    upper.push(mean + 2 * std);
    lower.push(mean - 2 * std);
  }
  return { upper, mid, lower };
}

function buildMarketReportText(symbol: string, history: MarketHistoryPoint[]): string {
  const displayRows = Math.min(5, history.length);
  const displayData = history.slice(-displayRows);
  const latest = displayData[displayData.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : latest;

  const change = latest.close - prev.close;
  const changePct = prev.close !== 0 ? (change / prev.close) * 100 : 0;

  const lines: string[] = [];
  const startDate = history[0]?.date ?? '';
  const endDate = latest.date;

  lines.push(`📊 ${symbol} - 技术分析数据`);
  lines.push(`数据期间: ${startDate} 至 ${endDate}`);
  lines.push(`数据条数: ${history.length}条 (展示最近${displayRows}个交易日)`);
  lines.push('');
  lines.push(`💰 最新价格: ¥${latest.close.toFixed(2)}`);
  lines.push(`📈 涨跌额: ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`);
  lines.push('');

  // MA
  lines.push('📊 移动平均线 (MA):');
  lines.push(formatMaLine('MA5', latest.ma5 ?? latest.close, latest.close));
  lines.push(formatMaLine('MA10', latest.ma10 ?? latest.close, latest.close));
  lines.push(formatMaLine('MA20', latest.ma20 ?? latest.close, latest.close));
  lines.push(formatMaLine('MA60', latest.ma60 ?? latest.close, latest.close));
  lines.push('');

  // MACD
  lines.push('📈 MACD指标:');
  lines.push(`   DIF:  ${(latest.macd_dif ?? 0).toFixed(3)}`);
  lines.push(`   DEA:  ${(latest.macd_dea ?? 0).toFixed(3)}`);
  const macdVal = latest.macd ?? 0;
  lines.push(`   MACD: ${macdVal.toFixed(3)}${macdVal > 0 ? ' (多头 ↑)' : ' (空头 ↓)'}`);
  if (history.length > 1) {
    const prevDif = history[history.length - 2].macd_dif ?? 0;
    const prevDea = history[history.length - 2].macd_dea ?? 0;
    const currDif = latest.macd_dif ?? 0;
    const currDea = latest.macd_dea ?? 0;
    if (prevDif <= prevDea && currDif > currDea) {
      lines.push('   ⚠️ MACD金叉信号（DIF上穿DEA）');
    } else if (prevDif >= prevDea && currDif < currDea) {
      lines.push('   ⚠️ MACD死叉信号（DIF下穿DEA）');
    }
  }
  lines.push('');

  // RSI
  lines.push('📉 RSI指标 (同花顺风格):');
  lines.push(formatRsiLine('RSI6', latest.rsi6 ?? 0));
  lines.push(formatRsiLine('RSI12', latest.rsi12 ?? 0));
  lines.push(formatRsiLine('RSI24', latest.rsi24 ?? 0));
  lines.push(`   RSI14: ${(latest.rsi14 ?? 0).toFixed(2)} (国际标准)`);
  lines.push('');

  // BOLL
  const bollPosition =
    latest.boll_upper && latest.boll_lower
      ? ((latest.close - latest.boll_lower) / (latest.boll_upper - latest.boll_lower)) * 100
      : 50;
  lines.push('📊 布林带 (BOLL):');
  lines.push(`   上轨: ¥${(latest.boll_upper ?? latest.close).toFixed(2)}`);
  lines.push(`   中轨: ¥${(latest.boll_mid ?? latest.close).toFixed(2)}`);
  lines.push(`   下轨: ¥${(latest.boll_lower ?? latest.close).toFixed(2)}`);
  lines.push(`   价格位置: ${bollPosition.toFixed(1)}% ${bollHint(bollPosition)}`);
  lines.push('');

  // 价格统计
  const highs = displayData.map((d) => d.high);
  const lows = displayData.map((d) => d.low);
  const closes = displayData.map((d) => d.close);
  const volumes = displayData.map((d) => d.volume);
  lines.push(`📊 价格统计 (最近${displayRows}个交易日):`);
  lines.push(`   最高价: ¥${Math.max(...highs).toFixed(2)}`);
  lines.push(`   最低价: ¥${Math.min(...lows).toFixed(2)}`);
  lines.push(`   平均价: ¥${(closes.reduce((s, v) => s + v, 0) / closes.length).toFixed(2)}`);
  const avgVol = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  lines.push(`   平均成交量: ${Math.round(avgVol).toLocaleString()} 股`);

  return lines.join('\n');
}

function formatMaLine(label: string, maValue: number, price: number): string {
  const direction = price > maValue ? ' (价格在均线上方 ↑)' : ' (价格在均线下方 ↓)';
  return `   ${label}: ¥${maValue.toFixed(2)}${direction}`;
}

function formatRsiLine(label: string, value: number): string {
  if (value >= 80) return `   ${label}: ${value.toFixed(2)} (超买 ⚠️)`;
  if (value <= 20) return `   ${label}: ${value.toFixed(2)} (超卖 ⚠️)`;
  return `   ${label}: ${value.toFixed(2)}`;
}

function bollHint(position: number): string {
  if (position >= 80) return '(接近上轨，可能超买 ⚠️)';
  if (position <= 20) return '(接近下轨，可能超卖 ⚠️)';
  return '(中性区域)';
}

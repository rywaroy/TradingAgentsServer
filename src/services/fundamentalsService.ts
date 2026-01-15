import dayjs from "dayjs";
import {
  requestTushareDailyBasic,
  requestTushareFinaIndicator,
  requestTushareTradeCal,
} from "../clients/tushareClient";
import { TUSHARE_TOKEN } from "../config/env";
import { runPythonScript } from "../utils/pythonBridge";

export interface FundamentalsData {
  pe: number;
  peTtm?: number;
  pb: number;
  roe: number;
  roa: number;
  growth: number;
  netMargin: number;
  grossMargin: number;
  debtRatio: number;
  currentRatio: number;
  quickRatio: number;
  ps: number;
  marketCap: number; // 单位：万元（与 Python get_cn_fund_snapshot 对齐）
  fundamentalScore?: number;
  valuationScore?: number;
  growthScore?: number;
  riskLevel?: string;
  source?: string;
}

// 核心入口：优先使用 Tushare 获取估值/增长/ROE，失败则调用 Python/akshare 兜底
export async function fetchFundamentals(
  symbol: string,
  analysisDate: string
): Promise<FundamentalsData> {
  const tsCode = toTsCode(symbol);
  const tradeDate = dayjs(analysisDate).format("YYYYMMDD");
  let tushareError: Error | null = null;

  if (TUSHARE_TOKEN) {
    try {
      const tushareData = await fetchByTushare(tsCode, tradeDate);
      if (tushareData) {
        // 若核心字段缺失，尝试用 akshare 补全再返回
        const needsPatch =
          tushareData.pe === 0 ||
          tushareData.pb === 0 ||
          tushareData.roe === 0 ||
          tushareData.netMargin === 0 ||
          tushareData.grossMargin === 0;
        if (needsPatch) {
          try {
            const ak = await fetchByAkshare(symbol);
            return { ...ak, source: "akshare" };
          } catch {
            // 无法补全则仍返回 Tushare 数据
          }
        }
        return { ...tushareData, source: "tushare" };
      }
    } catch (err) {
      tushareError = err as Error;
      console.warn(`Tushare 基本面获取失败: ${tushareError.message}`);
    }
  } else {
    tushareError = new Error("缺少 TUSHARE_TOKEN 环境变量");
  }

  try {
    const akData = await fetchByAkshare(symbol);
    return { ...akData, source: "akshare" };
  } catch (err) {
    console.warn(
      `${
        tushareError ? `Tushare 失败: ${tushareError.message}；` : ""
      }Akshare 兜底失败: ${(err as Error).message}`
    );
    // 缺失字段按约定置 0，避免中断主流程
    return {
      pe: 0,
      pb: 0,
      roe: 0,
      roa: 0,
      growth: 0,
      netMargin: 0,
      grossMargin: 0,
      debtRatio: 0,
      currentRatio: 0,
      quickRatio: 0,
      ps: 0,
      marketCap: 0,
      source: "fallback",
    };
  }
}

async function fetchByTushare(
  tsCode: string,
  analysisDate: string
): Promise<FundamentalsData | null> {
  const latestTradeDate = await resolveLatestTradeDate(analysisDate);
  const { fields, items } = await requestTushareDailyBasic(
    TUSHARE_TOKEN,
    tsCode,
    latestTradeDate
  );
  if (!items.length) {
    throw new Error(
      `Tushare daily_basic 返回空数据 ts_code=${tsCode} trade_date=${latestTradeDate}`
    );
  }
  const latestRow = items[0];
  const fieldIndex = (name: string) => fields.indexOf(name);

  const peTtmIdx = fieldIndex("pe_ttm");
  const peIdx = fieldIndex("pe");
  const pbIdx = fieldIndex("pb");
  const mvIdx = fieldIndex("total_mv");

  const peValue =
    pickNumber(latestRow[peTtmIdx]) ?? pickNumber(latestRow[peIdx]) ?? 0;
  const pbValue = pickNumber(latestRow[pbIdx]) ?? 0;
  const marketCap = pickNumber(latestRow[mvIdx]) ?? 0; // total_mv 单位：万元

  const { growth, roe, netMargin, grossMargin } =
    await fetchGrowthAndRoeFromFina(tsCode, latestTradeDate);

  return {
    pe: peValue,
    pb: pbValue,
    roe,
    roa: 0,
    growth,
    netMargin,
    grossMargin,
    debtRatio: 0,
    currentRatio: 0,
    quickRatio: 0,
    ps: 0,
    marketCap,
  };
}

async function fetchGrowthAndRoeFromFina(
  tsCode: string,
  endDate: string
): Promise<{
  growth: number;
  roe: number;
  netMargin: number;
  grossMargin: number;
}> {
  try {
    const { fields, items } = await requestTushareFinaIndicator(
      TUSHARE_TOKEN,
      tsCode,
      endDate
    );
    if (!items.length)
      return { growth: 0, roe: 0, netMargin: 0, grossMargin: 0 };

    // 按报告期/公告日期排序，取最近一条
    const endIdx = fields.indexOf("end_date");
    const annIdx = fields.indexOf("ann_date");
    const sorted = [...items].sort((a, b) => {
      const aDate = String(a[endIdx] || a[annIdx] || "");
      const bDate = String(b[endIdx] || b[annIdx] || "");
      return aDate.localeCompare(bDate);
    });
    const latest = sorted.pop() ?? items[0];

    const netprofitYoyIdx = fields.indexOf("netprofit_yoy");
    const qNetprofitYoyIdx = fields.indexOf("q_netprofit_yoy");
    const orYoyIdx = fields.indexOf("or_yoy");
    const roeIdx = fields.indexOf("roe");

    const netprofitYoy = pickNumber(latest[netprofitYoyIdx]);
    const qNetprofitYoy = pickNumber(latest[qNetprofitYoyIdx]);
    const orYoy = pickNumber(latest[orYoyIdx]);

    const growthPct = netprofitYoy ?? qNetprofitYoy ?? orYoy ?? 0;
    // Tushare 返回百分比，转换为 0-1 区间的小数
    const growth = growthPct / 100;

    const roeRaw = pickNumber(latest[roeIdx]) ?? 0;
    // Tushare roe 通常已是百分比数值
    const roe = roeRaw;

    const netMarginIdx = fields.indexOf("netprofit_margin");
    const grossMarginIdx = fields.indexOf("grossprofit_margin");
    const netMarginRaw = pickNumber(latest[netMarginIdx]) ?? 0;
    const grossMarginRaw = pickNumber(latest[grossMarginIdx]) ?? 0;

    return {
      growth,
      roe,
      netMargin: netMarginRaw,
      grossMargin: grossMarginRaw,
    };
  } catch (err) {
    console.warn(
      `fina_indicator 获取增长/ROE 数据失败: ${(err as Error).message}`
    );
    return { growth: 0, roe: 0, netMargin: 0, grossMargin: 0 };
  }
}

async function resolveLatestTradeDate(targetDate: string): Promise<string> {
  try {
    const start = dayjs(targetDate).subtract(20, "day").format("YYYYMMDD");
    const end = dayjs(targetDate).format("YYYYMMDD");
    const { fields, items } = await requestTushareTradeCal(
      TUSHARE_TOKEN,
      start,
      end
    );
    const dateIdx = fields.indexOf("cal_date");
    const openIdx = fields.indexOf("is_open");
    const openDates = items
      .map((row) => ({
        date: String(row[dateIdx]),
        isOpen: Number(row[openIdx]) === 1,
      }))
      .filter((d) => d.isOpen)
      .map((d) => d.date)
      .sort();
    const target = openDates.filter((d) => d <= end).pop();
    return target ?? end;
  } catch {
    return dayjs(targetDate).format("YYYYMMDD");
  }
}

async function fetchByAkshare(symbol: string): Promise<FundamentalsData> {
  const res = await runPythonScript<{
    pe?: number;
    pe_ttm?: number;
    pb?: number;
    roe?: number;
    roa?: number;
    growth?: number;
  net_margin?: number;
  gross_margin?: number;
  debt_ratio?: number;
  current_ratio?: number;
  quick_ratio?: number;
  ps?: number;
  market_cap?: number;
  fundamental_score?: number;
  valuation_score?: number;
  growth_score?: number;
  risk_level?: string;
  error?: string;
}>("fetch_fundamentals.py", {
  symbol,
});

  if (res?.error) {
    throw new Error(res.error);
  }

  return {
    pe: pickNumber(res?.pe) ?? 0,
    peTtm: pickNumber(res?.pe_ttm) ?? undefined,
    pb: pickNumber(res?.pb) ?? 0,
    roe: pickNumber(res?.roe) ?? 0,
    roa: pickNumber(res?.roa) ?? 0,
    growth: pickNumber(res?.growth) ?? 0,
    netMargin: pickNumber(res?.net_margin) ?? 0,
    grossMargin: pickNumber(res?.gross_margin) ?? 0,
    debtRatio: pickNumber(res?.debt_ratio) ?? 0,
    currentRatio: pickNumber(res?.current_ratio) ?? 0,
    quickRatio: pickNumber(res?.quick_ratio) ?? 0,
    ps: pickNumber(res?.ps) ?? 0,
    marketCap: pickNumber(res?.market_cap) ?? 0,
    fundamentalScore: pickNumber(res?.fundamental_score) ?? undefined,
    valuationScore: pickNumber(res?.valuation_score) ?? undefined,
    growthScore: pickNumber(res?.growth_score) ?? undefined,
    riskLevel: res?.risk_level,
  };
}

function pickNumber(input: any): number | null {
  const num = Number(input);
  if (!Number.isFinite(num)) return null;
  return num;
}

function toTsCode(symbol: string): string {
  return symbol.startsWith("6") ? `${symbol}.SH` : `${symbol}.SZ`;
}

import dayjs from "dayjs";
import { fetchMarketData, MarketData } from "./marketDataService";
import { fetchNews, NewsItem } from "./newsService";

export interface AnalysisParameters {
  market_type?: "A股";
  analysis_date?: string;
  research_depth?: "快速" | "基础" | "标准" | "深度" | "全面";
  selected_analysts?: string[];
  include_sentiment?: boolean;
  include_risk?: boolean;
  quick_analysis_model?: string;
  deep_analysis_model?: string;
  // 预留额外参数，便于后续扩展
  [key: string]: unknown;
}

interface SentimentData {
  score: number;
}

interface FundamentalsData {
  pe: number;
  growth: number;
}

interface TradePlan {
  action: "买入" | "卖出" | "持有";
  target: number;
  confidence: number;
  recommendation: string;
  summary: string;
  keyPoints: string[];
  reasoning: string;
}

interface RiskDecision {
  level: string;
  score: number;
  detail: string;
}

interface MarketInfo {
  market: string;
  currency: string;
}

export interface AnalysisResult {
  analysis_id: string;
  stock_symbol: string;
  analysis_date: string;
  summary: string;
  recommendation: string;
  confidence_score: number;
  risk_level: string;
  key_points: string[];
  reports: {
    market_report: string;
    news_report: string;
    sentiment_report: string;
    fundamentals_report: string;
    investment_plan: string;
    trader_investment_plan: string;
    final_trade_decision: string;
    risk_management_decision: string;
  };
  decision: {
    action: TradePlan["action"];
    target_price: number;
    confidence: number;
    risk_score: number;
    reasoning: string;
    model_info: string;
  };
  performance_metrics: {
    exec_ms: number;
  };
}

export async function runAnalysis({
  symbol,
  parameters = {},
}: {
  symbol: string;
  parameters?: AnalysisParameters;
}): Promise<any> {
  if (parameters.market_type && parameters.market_type !== "A股") {
    throw new Error("仅支持 A 股市场类型");
  }

  const normalizedAnalysisDate = normalizeAnalysisDate(
    parameters.analysis_date
  );

  const normalizedParameters: Required<
    Pick<
      AnalysisParameters,
      | "market_type"
      | "analysis_date"
      | "research_depth"
      | "selected_analysts"
      | "include_sentiment"
      | "include_risk"
      | "quick_analysis_model"
      | "deep_analysis_model"
    >
  > = {
    market_type: "A股",
    analysis_date: normalizedAnalysisDate,
    research_depth: parameters.research_depth ?? "标准",
    selected_analysts: parameters.selected_analysts ?? [
      "market",
      "fundamentals",
      "news",
      "social",
    ],
    include_sentiment: parameters.include_sentiment ?? true,
    include_risk: parameters.include_risk ?? true,
    quick_analysis_model: parameters.quick_analysis_model ?? "qwen-turbo",
    deep_analysis_model: parameters.deep_analysis_model ?? "qwen-max",
  };

  validateSymbol(symbol, normalizedAnalysisDate);
  const marketInfo: MarketInfo = detectMarket(symbol);
  const includeMarket =
    normalizedParameters.selected_analysts.includes("market");
  const includeNews =
    normalizedParameters.selected_analysts.includes("news");

  // 1) 数据获取：此处为占位实现，便于后续接入行情、新闻、情绪、财报服务
  const marketData = includeMarket
    ? await fetchMarketData(symbol, normalizedAnalysisDate)
    : null;
  const newsData = includeNews ? await fetchNews(symbol) : [];
  const sentimentData = await fetchSentiment(symbol);
  const fundamentalsData = await fetchFundamentals(symbol);

  // 2) 分析师阶段：拼装报告
  const marketReport = includeMarket
    ? buildMarketReport(marketData, marketInfo)
    : "【市场】未选择市场分析";
  const newsReport = buildNewsReport(newsData);
  const sentimentReport = buildSentimentReport(sentimentData);
  const fundamentalsReport = buildFundamentalsReport(fundamentalsData);

  // 3) 多空辩论与研究结论
  const bullView = buildBullView(marketReport, fundamentalsReport);
  const bearView = buildBearView(sentimentReport, newsReport);
  const researchDecision = synthesizeResearch(bullView, bearView);

  // 4) 交易与风险
  const tradePlan = buildTradePlan(researchDecision);
  const riskDecision = evaluateRisk(tradePlan);

  // 5) 汇总结果
  return {
    analysis_id: `${symbol}-${Date.now()}`,
    stock_symbol: symbol,
    analysis_date: normalizedAnalysisDate,
    summary: tradePlan.summary,
    recommendation: tradePlan.recommendation,
    confidence_score: tradePlan.confidence,
    risk_level: riskDecision.level,
    key_points: tradePlan.keyPoints,
    reports: {
      market_report: marketReport,
      news_report: newsReport,
      sentiment_report: sentimentReport,
      fundamentals_report: fundamentalsReport,
      investment_plan: researchDecision,
      trader_investment_plan: tradePlan.recommendation,
      final_trade_decision: tradePlan.recommendation,
      risk_management_decision: riskDecision.detail,
    },
    decision: {
      action: tradePlan.action,
      target_price: tradePlan.target,
      confidence: tradePlan.confidence,
      risk_score: riskDecision.score,
      reasoning: tradePlan.reasoning,
      model_info: "rule-based-mock",
    },
    performance_metrics: { exec_ms: 0 },
  };
}

async function fetchSentiment(_symbol: string): Promise<SentimentData> {
  return { score: 0.2 };
}

async function fetchFundamentals(_symbol: string): Promise<FundamentalsData> {
  return { pe: 15, growth: 0.12 };
}

function buildMarketReport(
  data: MarketData | null,
  marketInfo: MarketInfo
): string {
  return `【市场】${marketInfo.market}（${marketInfo.currency}）\n${data?.report}`;
}

function buildNewsReport(items: NewsItem[]): string {
  return items.map((n) => `【新闻】${n.title} (${n.impact})`).join("\n");
}

function buildSentimentReport(sentiment: SentimentData): string {
  return `【情绪】情绪得分：${sentiment.score}`;
}

function buildFundamentalsReport(fundamentals: FundamentalsData): string {
  return `【基本面】PE=${fundamentals.pe}，增长=${(
    fundamentals.growth * 100
  ).toFixed(1)}%`;
}

function buildBullView(
  marketReport: string,
  fundamentalsReport: string
): string {
  return `看多理由：\n${marketReport}\n${fundamentalsReport}`;
}

function buildBearView(sentimentReport: string, newsReport: string): string {
  return `看空理由：\n${sentimentReport}\n${newsReport}`;
}

function synthesizeResearch(bullView: string, bearView: string): string {
  return `研究结论：权衡多空。\n${bullView}\n${bearView}`;
}

function buildTradePlan(researchDecision: string): TradePlan {
  return {
    action: "买入",
    target: 12.3,
    confidence: 0.62,
    recommendation: "买入，目标价 12.3 元，持有 3-6 个月",
    summary: "技术面与基本面偏多，短期情绪中性。",
    keyPoints: ["技术面站上均线", "估值合理"],
    reasoning: researchDecision,
  };
}

function evaluateRisk(tradePlan: TradePlan): RiskDecision {
  return {
    level: "中等",
    score: 0.35,
    detail: "波动中等，关注成交量与政策风险",
  };
}

function normalizeAnalysisDate(dateInput?: string): string {
  if (!dateInput) return dayjs().format("YYYY-MM-DD");
  const parsed = dayjs(dateInput);
  if (!parsed.isValid()) {
    throw new Error("analysis_date 无效，需 YYYY-MM-DD 格式");
  }
  return parsed.format("YYYY-MM-DD");
}

function validateSymbol(symbol: string, analysisDate: string): void {
  if (!/^\d{6}$/.test(symbol)) {
    throw new Error("仅支持 6 位 A 股代码");
  }
  const parsed = dayjs(analysisDate);
  if (!parsed.isValid()) {
    throw new Error("分析日期格式错误，需 YYYY-MM-DD");
  }
}

function detectMarket(_symbol: string): MarketInfo {
  // 当前仅支持 A 股，默认使用人民币计价
  return { market: "A股", currency: "CNY" };
}

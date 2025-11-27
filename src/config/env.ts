import dotenv from 'dotenv';

dotenv.config();

export const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || '';
export const MARKET_ANALYST_LOOKBACK_DAYS = Number.isFinite(Number(process.env.MARKET_ANALYST_LOOKBACK_DAYS))
  ? Number(process.env.MARKET_ANALYST_LOOKBACK_DAYS)
  : 30;

import dotenv from 'dotenv';

dotenv.config();

export const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || '';
export const MARKET_ANALYST_LOOKBACK_DAYS = Number.isFinite(Number(process.env.MARKET_ANALYST_LOOKBACK_DAYS))
  ? Number(process.env.MARKET_ANALYST_LOOKBACK_DAYS)
  : 30;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

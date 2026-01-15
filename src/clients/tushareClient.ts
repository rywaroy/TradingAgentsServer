import axios, { AxiosError } from 'axios';

interface TushareResponse<T> {
  code: number;
  msg: string;
  data?: {
    fields: string[];
    items: T[][];
  };
}

const TUSHARE_API_URL = 'https://api.tushare.pro';
const DEFAULT_HTTP_TIMEOUT = 8000;
const RETRY_TIMES = 2;

export async function requestTushareDailyBasic(
  token: string,
  tsCode: string,
  tradeDate: string,
  fields = 'ts_code,trade_date,pe,pe_ttm,pb,total_mv'
): Promise<{ fields: string[]; items: any[][] }> {
  const payload = {
    api_name: 'daily_basic',
    token,
    params: { ts_code: tsCode, trade_date: tradeDate },
    fields
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_TIMES; attempt += 1) {
    try {
      const { data } = await axios.post<TushareResponse<any>>(TUSHARE_API_URL, payload, {
        timeout: DEFAULT_HTTP_TIMEOUT
      });
      if (data.code !== 0) {
        throw new Error(`Tushare daily_basic 返回错误 code=${data.code} msg=${data.msg || ''}`);
      }
      if (!data.data?.fields || !data.data?.items) {
        throw new Error('Tushare daily_basic 返回缺少 data.fields 或 data.items');
      }
      return { fields: data.data.fields, items: data.data.items };
    } catch (error) {
      lastError = wrapAxiosError(error, tsCode, tradeDate, 'daily_basic');
      if (attempt === RETRY_TIMES) break;
      await delay(300 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('Tushare daily_basic 请求失败，未知错误');
}

export async function requestTushareFinaIndicator(
  token: string,
  tsCode: string,
  endDate: string,
  fields = 'ts_code,end_date,ann_date,netprofit_yoy,q_netprofit_yoy,or_yoy,roe,netprofit_margin,grossprofit_margin'
): Promise<{ fields: string[]; items: any[][] }> {
  const payload = {
    api_name: 'fina_indicator',
    token,
    params: { ts_code: tsCode, end_date: endDate, limit: 5 },
    fields
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_TIMES; attempt += 1) {
    try {
      const { data } = await axios.post<TushareResponse<any>>(TUSHARE_API_URL, payload, {
        timeout: DEFAULT_HTTP_TIMEOUT
      });
      if (data.code !== 0) {
        throw new Error(`Tushare fina_indicator 返回错误 code=${data.code} msg=${data.msg || ''}`);
      }
      if (!data.data?.fields || !data.data?.items) {
        throw new Error('Tushare fina_indicator 返回缺少 data.fields 或 data.items');
      }
      return { fields: data.data.fields, items: data.data.items };
    } catch (error) {
      lastError = wrapAxiosError(error, tsCode, endDate, 'fina_indicator');
      if (attempt === RETRY_TIMES) break;
      await delay(300 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('Tushare fina_indicator 请求失败，未知错误');
}

export async function requestTushareDaily(
  token: string,
  tsCode: string,
  startDate: string,
  endDate: string,
  fields = 'trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount'
): Promise<{ fields: string[]; items: any[][] }> {
  const payload = {
    api_name: 'daily',
    token,
    params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
    fields
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_TIMES; attempt += 1) {
    try {
      const { data } = await axios.post<TushareResponse<any>>(TUSHARE_API_URL, payload, {
        timeout: DEFAULT_HTTP_TIMEOUT
      });

      if (data.code !== 0) {
        throw new Error(`Tushare 返回错误 code=${data.code} msg=${data.msg || ''}`);
      }
      if (!data.data?.fields || !data.data?.items) {
        throw new Error('Tushare 返回缺少 data.fields 或 data.items');
      }
      return { fields: data.data.fields, items: data.data.items };
    } catch (error) {
      lastError = wrapAxiosError(error, tsCode, startDate, endDate);
      if (attempt === RETRY_TIMES) break;
      await delay(300 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('Tushare 请求失败，未知错误');
}

export async function requestTushareTradeCal(
  token: string,
  startDate: string,
  endDate: string
): Promise<{ fields: string[]; items: any[][] }> {
  const payload = {
    api_name: 'trade_cal',
    token,
    params: { exchange: 'SSE', start_date: startDate, end_date: endDate },
    fields: 'cal_date,is_open,pretrade_date'
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_TIMES; attempt += 1) {
    try {
      const { data } = await axios.post<TushareResponse<any>>(TUSHARE_API_URL, payload, {
        timeout: DEFAULT_HTTP_TIMEOUT
      });

      if (data.code !== 0) {
        throw new Error(`Tushare 返回错误 code=${data.code} msg=${data.msg || ''}`);
      }
      if (!data.data?.fields || !data.data?.items) {
        throw new Error('Tushare 返回缺少 data.fields 或 data.items');
      }
      return { fields: data.data.fields, items: data.data.items };
    } catch (error) {
      lastError = wrapAxiosError(error, 'SSE', startDate, endDate);
      if (attempt === RETRY_TIMES) break;
      await delay(300 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('Tushare 交易日历请求失败，未知错误');
}

function wrapAxiosError(error: unknown, tsCode: string, startDate: string, endDate: string, apiName = 'daily'): Error {
  if (error instanceof Error && (error as AxiosError).isAxiosError) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const statusText = axiosError.response?.statusText;
    return new Error(
      `Tushare(${apiName}) 请求异常 ts_code=${tsCode} start=${startDate} end=${endDate} status=${status} ${statusText ?? ''} ${axiosError.message}`
    );
  }
  if (error instanceof Error) {
    return new Error(`Tushare(${apiName}) 请求异常 ts_code=${tsCode} start=${startDate} end=${endDate}: ${error.message}`);
  }
  return new Error(`Tushare(${apiName}) 请求异常 ts_code=${tsCode} start=${startDate} end=${endDate}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

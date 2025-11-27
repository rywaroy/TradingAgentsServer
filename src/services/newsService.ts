import axios from "axios";
import type { AxiosRequestConfig } from "axios";
import { load } from "cheerio";
import { runPythonScript } from "../utils/pythonBridge";

export interface NewsItem {
  title: string;
  impact: "pos" | "neg" | "neutral";
  source?: string;
  publishTime?: string;
  summary?: string;
  url?: string;
  content?: string;
  author?: string;
}

// 新闻获取主流程：akshare(Python) → 新浪爬虫（列表页 + 详情页）
export async function fetchNews(
  symbol: string,
  maxNews = 10
): Promise<NewsItem[]> {
  const normalized = symbol.trim();
  const fetchers: Array<() => Promise<NewsItem[]>> = [
    () => fetchNewsByAkshare(normalized, maxNews),
    () => fetchSinaNews(normalized, maxNews)
  ];

  for (const fetcher of fetchers) {
    try {
      const items = await fetcher();
      if (items.length) {
        return items.map(normalizeNewsItem);
      }
    } catch (err) {
      // 保持兜底链路不中断
      console.warn(`新闻获取步骤失败: ${(err as Error).message}`);
    }
  }

  return [];
}

async function fetchNewsByAkshare(
  symbol: string,
  maxNews: number
): Promise<NewsItem[]> {
  try {
    const res = await runPythonScript<{
      items: Array<{
        title?: string;
        impact?: string;
        source?: string;
        publish_time?: string;
        summary?: string;
        url?: string;
        content?: string;
        author?: string;
      }>;
    }>("news_sync.py", { symbol, max_news: maxNews });
    if (!res?.items?.length) return [];
    return res.items
      .map((raw) => ({
        title: raw.title ?? "",
        impact: normalizeImpact(raw.impact),
        source: raw.source,
        publishTime: raw.publish_time,
        summary: raw.summary,
        url: raw.url,
        content: raw.content,
        author: raw.author,
      }))
      .filter((n) => n.title);
  } catch (err) {
    console.warn(`akshare 新闻失败: ${(err as Error).message}`);
    return [];
  }
}

async function fetchSinaNews(
  symbol: string,
  maxNews: number
): Promise<NewsItem[]> {
  const code = toSinaSymbol(symbol);
  const listUrl = `https://vip.stock.finance.sina.com.cn/corp/go.php/vCB_AllNewsStock/symbol/${code}.phtml`;

  try {
    const { data: html } = await requestWithRetry<string>(
      listUrl,
      getSinaHeaders(),
      1,
      8000
    );

    const $ = load(html);
    const links = $(".datelist a")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean)
      .map((href) => normalizeUrl(String(href)))
      .filter((href) => !!href)
      .slice(0, maxNews);

    const newsItems: NewsItem[] = [];
    for (const url of links) {
      const detail = await fetchSinaDetail(url);
      if (detail) {
        newsItems.push(detail);
      }
      // 避免短时间内频繁请求被限流
      await delay(1000);
    }

    return newsItems;
  } catch (err) {
    console.warn(`新浪新闻获取失败: ${(err as Error).message}`);
    return [];
  }
}

async function requestWithRetry<T = any>(
  url: string,
  config: AxiosRequestConfig,
  retries = 2,
  timeoutMs = 5000
): Promise<{ data: T }> {
  let lastError: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.request<T>({
        url,
        timeout: timeoutMs,
        ...config,
      });
    } catch (err) {
      lastError = err;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastError;
}

function normalizeImpact(impact?: string): "pos" | "neg" | "neutral" {
  if (impact === "pos" || impact === "neg" || impact === "neutral")
    return impact;
  return "neutral";
}

function normalizeNewsItem(item: NewsItem): NewsItem {
  return {
    title: item.title?.trim() || "",
    impact: normalizeImpact(item.impact),
    source: item.source,
    publishTime: item.publishTime,
    summary: item.summary,
    url: item.url,
    content: item.content,
    author: item.author,
  };
}

function toSinaSymbol(symbol: string): string {
  let prefix = "sh";
  if (symbol.startsWith("60") || symbol.startsWith("68") || symbol.startsWith("90")) {
    prefix = "sh";
  } else if (symbol.startsWith("00") || symbol.startsWith("30") || symbol.startsWith("20")) {
    prefix = "sz";
  } else if (symbol.startsWith("8") || symbol.startsWith("4")) {
    prefix = "bj";
  }
  return `${prefix}${symbol}`;
}

function normalizeUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("//")) return `https:${href}`;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `https://finance.sina.com.cn${href}`;
  return href;
}

async function fetchSinaDetail(url: string): Promise<NewsItem | null> {
  try {
    const { data: html } = await requestWithRetry<string>(
      url,
      getSinaHeaders(),
      1,
      8000
    );
    const $ = load(html);
    const title =
      $(".main-title").first().text().trim() || $("h1").first().text().trim();
    if (!title) return null;
    const publishTime = $(".date").first().text().trim();
    const source = $(".source").first().text().trim() || "新浪财经";
    const content = $("#artibody").text().trim();
    const summary = content ? content.slice(0, 120) : "";

    return {
      title,
      impact: "neutral",
      source,
      publishTime,
      summary,
      url,
      content,
      author: "",
    };
  } catch (err) {
    console.warn(`新浪详情抓取失败(${url}): ${(err as Error).message}`);
    return null;
  }
}

function getSinaHeaders(): AxiosRequestConfig {
  return {
    headers: {
      Referer: "https://finance.sina.com.cn",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

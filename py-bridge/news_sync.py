#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
使用 akshare 拉取 A 股个股新闻
输入: {"symbol": "600519", "max_news": 10}
输出: {"items": [{"title": "...", "impact": "neutral", "source": "...", "publish_time": "...", "summary": "", "url": "", "content": "", "author": ""}]}
注：若 akshare 调用失败或无数据，返回空列表，交由 Node 兜底。
"""

import json
import sys
from typing import Any, Dict, List

import requests


def main() -> None:
    payload = _read_payload()
    symbol = payload.get("symbol", "").strip()
    base_symbol = symbol[-6:]  # 仅保留 6 位代码
    max_news = int(payload.get("max_news", 10) or 10)

    if not base_symbol:
        _emit([])
        return

    try:
        import akshare as ak  # type: ignore
    except Exception as e:
        sys.stderr.write(f"导入 akshare 失败: {e}\n")
        ak = None

    # 先尝试 akshare，失败再走自建 HTTP 请求（带 UA/Referer 规避空响应）
    items: List[Dict[str, Any]] = []
    if ak is not None:
        try:
            items = _fetch_by_akshare(ak, base_symbol, max_news)
        except Exception as e:
            sys.stderr.write(f"akshare stock_news_em 调用失败: {e}\n")
            items = []

    if not items:
        try:
            items = _fetch_by_http(base_symbol, max_news)
        except Exception as e:
            sys.stderr.write(f"东财 search-api 兜底失败: {e}\n")
            items = []

    _emit(items)


def _fetch_by_akshare(ak, symbol: str, max_news: int) -> List[Dict[str, Any]]:
    df = ak.stock_news_em(symbol=symbol)
    if df is None or df.empty:
        return []

    # 尝试按发布时间排序
    time_col = None
    for c in ["public_time", "publish_time", "datetime", "time"]:
        if c in df.columns:
            time_col = c
            break
    if time_col:
        df = df.sort_values(by=time_col, ascending=False)

    items: List[Dict[str, Any]] = []
    for _, row in df.head(max_news).iterrows():
        data = row.to_dict()
        title = str(
            data.get("title")
            or data.get("art_title")
            or data.get("digest")
            or data.get("摘要")
            or ""
        ).strip()
        if not title:
            continue

        source = str(data.get("source") or data.get("media_name") or data.get("来源") or "akshare").strip()
        publish_time = _format_time(data.get(time_col)) if time_col else ""

        items.append(
            {
                "title": title,
                "impact": "neutral",
                "source": source,
                "publish_time": publish_time,
                "summary": data.get("digest") or data.get("summary") or "",
                "url": data.get("url") or "",
                "content": data.get("content") or "",
                "author": data.get("author") or "",
            }
        )
    return items


def _fetch_by_http(symbol: str, max_news: int) -> List[Dict[str, Any]]:
    """直连东财搜索接口，补充 UA/Referer 防止空响应"""
    param_obj = {
        "uid": "",
        "keyword": symbol,
        "type": ["cmsArticle"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticle": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": 1,
                "pageSize": max_news,
                "preTag": "<em>",
                "postTag": "</em>",
            }
        },
    }
    params = {"cb": "cb", "param": json.dumps(param_obj, ensure_ascii=False)}
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://so.eastmoney.com/",
    }
    resp = requests.get(
        "https://search-api-web.eastmoney.com/search/jsonp",
        params=params,
        headers=headers,
        timeout=15,
    )
    text = (resp.text or "").strip()
    if not text or "(" not in text or ")" not in text:
        return []
    json_str = text[text.find("(") + 1 : text.rfind(")")]
    data = json.loads(json_str)
    articles = data.get("result", {}).get("cmsArticle", []) or []

    items: List[Dict[str, Any]] = []
    for art in articles[:max_news]:
        title = _strip_em(str(art.get("title") or ""))
        if not title:
            continue
        url = art.get("url") or ""
        if not url and art.get("code"):
            url = f"http://finance.eastmoney.com/a/{art.get('code')}.html"
        items.append(
            {
                "title": title,
                "impact": "neutral",
                "source": art.get("mediaName") or "eastmoney",
                "publish_time": art.get("date") or "",
                "summary": _strip_em(art.get("digest") or art.get("content") or ""),
                "url": url,
                "content": _strip_em(art.get("content") or ""),
                "author": art.get("author") or "",
            }
        )
    return items


def _strip_em(text: str) -> str:
    """去掉东财返回中的 <em> 标记"""
    return str(text).replace("<em>", "").replace("</em>", "").strip()


def _format_time(value: Any) -> str:
    if value is None:
        return ""
    try:
        s = str(value).strip()
        if not s:
            return ""
        if s.isdigit() and len(s) in (10, 13):
            import datetime as dt

            ts = int(s[:10])
            return dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass
    return str(value)


def _read_payload() -> Dict[str, Any]:
    try:
        return json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"读取输入失败: {e}\n")
        return {}


def _emit(items: List[Dict[str, Any]]) -> None:
    print(json.dumps({"items": items}, ensure_ascii=False))


if __name__ == "__main__":
    main()

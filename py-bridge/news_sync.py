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


def main() -> None:
    payload = _read_payload()
    symbol = payload.get("symbol", "").strip()
    max_news = int(payload.get("max_news", 10) or 10)

    if not symbol:
        _emit([])
        return

    try:
        import akshare as ak  # type: ignore
    except Exception as e:
        sys.stderr.write(f"导入 akshare 失败: {e}\n")
        _emit([])
        return

    try:
        df = ak.stock_news_em(symbol=symbol)
    except Exception as e:
        sys.stderr.write(f"akshare stock_news_em 调用失败: {e}\n")
        _emit([])
        return

    if df is None or df.empty:
        _emit([])
        return

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

    _emit(items)


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

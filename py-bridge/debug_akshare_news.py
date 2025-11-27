#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
快速调试 akshare 新闻接口：
python debug_akshare_news.py 600519 10
"""

import sys
import json

def main():
    if len(sys.argv) < 2:
        print("用法: python debug_akshare_news.py <symbol> [max_news]", file=sys.stderr)
        sys.exit(1)

    symbol = sys.argv[1]
    max_news = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    try:
        import akshare as ak  # type: ignore
    except Exception as e:
        print(f"导入 akshare 失败: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        df = ak.stock_news_em(symbol=symbol)
    except Exception as e:
        print(f"stock_news_em 调用失败: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"返回行数: {0 if df is None else len(df)}")
    if df is None or df.empty:
        return

    # 打印前几条记录的关键字段
    cols = df.columns.tolist()
    print(f"字段: {cols}")
    preview = []
    for _, row in df.head(max_news).iterrows():
        d = row.to_dict()
        preview.append(
            {
                "title": d.get("title") or d.get("art_title") or d.get("digest"),
                "source": d.get("source") or d.get("media_name"),
                "time": d.get("publish_time") or d.get("datetime") or d.get("showtime"),
            }
        )
    print(json.dumps(preview, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import sys
import json
from datetime import datetime


def main():
    payload = json.load(sys.stdin)
    symbol = str(payload.get("symbol", "")).strip()
    start_date = str(payload.get("start_date", "")).strip()
    end_date = str(payload.get("end_date", "")).strip()

    if not symbol or not start_date or not end_date:
        sys.stderr.write("参数缺失: symbol/start_date/end_date\n")
        sys.exit(1)

    try:
        import akshare as ak
    except Exception as e:
        sys.stderr.write(f"导入 akshare 失败: {e}\n")
        sys.exit(1)

    try:
        # akshare 需要 YYYYMMDD 格式
        df = ak.stock_zh_a_hist(symbol=symbol, start_date=start_date, end_date=end_date, adjust="qfq")
    except Exception as e:
        sys.stderr.write(f"akshare 获取行情失败: {e}\n")
        sys.exit(1)

    if df is None or df.empty:
        sys.stderr.write("akshare 返回空数据\n")
        sys.exit(1)

    # 标准化字段
    df = df.rename(
        columns={
            "日期": "trade_date",
            "开盘": "open",
            "最高": "high",
            "最低": "low",
            "收盘": "close",
            "成交量": "vol",
            "成交额": "amount"
        }
    )

    # 确保日期格式一致 YYYYMMDD
    df["trade_date"] = df["trade_date"].apply(
        lambda d: datetime.strptime(str(d), "%Y-%m-%d").strftime("%Y%m%d")
        if isinstance(d, str) and "-" in d
        else str(d)
    )

    df = df.sort_values("trade_date")
    df["pre_close"] = df["close"].shift(1)
    df["change"] = df["close"].diff()
    df["pct_chg"] = df["change"] / df["pre_close"] * 100

    items = []
    for _, row in df.iterrows():
        items.append(
            {
                "trade_date": str(row["trade_date"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "pre_close": float(row["pre_close"]) if not is_nan(row["pre_close"]) else None,
                "change": float(row["change"]) if not is_nan(row["change"]) else None,
                "pct_chg": float(row["pct_chg"]) if not is_nan(row["pct_chg"]) else None,
                "vol": float(row["vol"]) if "vol" in row else 0.0,
                "amount": float(row["amount"]) if "amount" in row else 0.0,
            }
        )

    print(json.dumps({"items": items}, ensure_ascii=False))


def is_nan(x):
    try:
        return float(x) != float(x)
    except Exception:
        return True


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
使用 akshare 获取 A 股基本面快照（PE、增长率），供 Node 兜底调用。
输入：stdin JSON {"symbol": "600519"}
输出：{"pe": number, "pb": number, "roe": number, "growth": number, "net_margin": number, "gross_margin": number, "market_cap": number}
"""
import json
import sys
from typing import Any, Dict, Optional, List


def safe_float(val: Any) -> Optional[float]:
    try:
        if val is None:
            return None
        f = float(val)
        if f != f:  # NaN 检查
            return None
        return f
    except Exception:
        return None


def parse_growth(latest: Dict[str, Any]) -> Optional[float]:
    # 支持多种字段命名，优先净利润、其次营收
    candidates = [
        "净利润同比增长",
        "净利润同比增长率",
        "归母净利润同比增长",
        "归母净利润同比增长率",
        "净利润增长率",
        "净利润同比",
        "营业收入同比增长",
        "营业收入同比增长率",
        "营业收入增长率",
        "营收同比",
    ]
    # 直接遍历字段模糊匹配
    for key, raw in latest.items():
        name = str(key)
        lower_name = name.lower()
        if any(kw in name for kw in candidates) or "同比" in name or "增长" in name or "yoy" in lower_name:
            val = safe_float(raw)
            if val is None:
                continue
            return val / 100 if abs(val) > 1 else val
    return None


def pick_by_keywords(latest: Dict[str, Any], keywords) -> Optional[float]:
    for key, raw in latest.items():
        name = str(key)
        lower_name = name.lower()
        if any(kw.lower() in lower_name for kw in keywords):
            val = safe_float(raw)
            if val is not None:
                return val
    return None


def fill_from_spot(symbol: str, result: Dict[str, Any]) -> None:
    """从行情快照补齐 PE/PB/市值（akshare stock_zh_a_spot_em）"""
    try:
        import akshare as ak  # type: ignore

        df_spot = ak.stock_zh_a_spot_em()
        if df_spot is None or df_spot.empty:
            return
        row = df_spot[df_spot["代码"] == symbol]
        if row is None or row.empty:
            return
        rec = row.iloc[0]
        pe_candidates = ["市盈率-动态", "市盈率(动态)", "市盈率"]
        pb_candidates = ["市净率"]
        mv_candidates = ["总市值", "总市值(亿元)"]

        for col in pe_candidates:
            if col in rec and result.get("pe") == 0:
                val = safe_float(rec[col])
                if val is not None:
                    result["pe"] = val
                    break

        for col in pb_candidates:
            if col in rec and result.get("pb") == 0:
                val = safe_float(rec[col])
                if val is not None:
                    result["pb"] = val
                    break

        for col in mv_candidates:
            if col in rec and result.get("market_cap") == 0:
                val = safe_float(rec[col])
                if val is not None:
                    # stock_zh_a_spot_em 总市值单位：亿元
                    result["market_cap"] = val * 10000
                    break
    except Exception:
        # 忽略 akshare 失败，稍后走 HTTP 兜底
        pass

    # 若仍缺，直接调用东财行情接口兜底
    if (result.get("pe") == 0 or result.get("pb") == 0 or result.get("market_cap") == 0):
        try:
            quote = fetch_quote_from_eastmoney(symbol)
            if quote:
                if result.get("pe") == 0 and quote.get("pe") is not None:
                    result["pe"] = quote["pe"]
                if result.get("pb") == 0 and quote.get("pb") is not None:
                    result["pb"] = quote["pb"]
                if result.get("market_cap") == 0 and quote.get("market_cap") is not None:
                    result["market_cap"] = quote["market_cap"]
        except Exception:
            return


def get_latest_row(df):
    if df is None or df.empty:
        return None
    # 优先按 REPORT_DATE 排序
    if "REPORT_DATE" in df.columns:
        try:
            df_sorted = df.sort_values("REPORT_DATE")
            return df_sorted.iloc[-1].to_dict()
        except Exception:
            pass
    # 尝试按首列排序（通常是报告期/日期），取最后一行
    first_col = df.columns[0]
    try:
        df_sorted = df.sort_values(first_col)
    except Exception:
        df_sorted = df
    return df_sorted.iloc[-1].to_dict()


def extract_metric(row: Dict[str, Any], keywords) -> Optional[float]:
    if not row:
        return None
    for key, raw in row.items():
        name = str(key)
        lower_name = name.lower()
        if any(k.lower() in lower_name for k in keywords):
            val = safe_float(raw)
            if val is not None:
                return val
    return None


def extract_from_abstract(df, keywords: List[str]) -> Optional[float]:
    """
    针对 stock_financial_abstract 的行转列结构，按指标行取最新列值。
    """
    if df is None or df.empty:
        return None
    try:
        candidates = df[df["指标"].astype(str).apply(lambda x: any(k.lower() in str(x).lower() for k in keywords))]
        if candidates.empty:
            return None
        row = candidates.iloc[0].to_dict()
        date_cols = [c for c in df.columns if c not in ("选项", "指标")]
        # 列名是日期，按字符串逆序获取最新
        for col in sorted(date_cols, reverse=True):
            val = safe_float(row.get(col))
            if val is not None:
                return val
    except Exception:
        return None
    return None


def safe_div(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None:
        return None
    if denominator == 0:
        return None
    return numerator / denominator


def format_em_symbol(symbol: str) -> str:
    """将纯 6 位代码转换为东财接口需要的市场前缀格式"""
    code = symbol.strip().lower()
    if not code:
        return code
    if code.startswith(("sh", "sz", "bj")):
        return code
    first = code[0]
    if first in ("6", "9"):
        return f"sh{code}"
    if first in ("0", "2", "3"):
        return f"sz{code}"
    if first in ("4", "8"):
        return f"bj{code}"
    return f"sh{code}"


def fetch_quote_from_eastmoney(symbol: str) -> Optional[Dict[str, float]]:
    """
    直接调用东财行情接口获取市值/PE/PB（避免 akshare 代理问题）
    f162: 动态市盈率（乘以 100 后数值）; f167: 市净率（*100）; f116: 总市值（元）
    """
    try:
        import requests  # type: ignore
    except Exception:
        return None

    code = symbol[-6:]
    market = "1" if code.startswith(("6", "9")) else "0"
    secid = f"{market}.{code}"
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    params = {
        "secid": secid,
        "fields": "f162,f167,f116",
    }
    resp = requests.get(
        url,
        params=params,
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"},
        timeout=10,
    )
    data = resp.json().get("data") if resp is not None else None
    if not data:
        return None
    pe_raw = safe_float(data.get("f162"))
    pb_raw = safe_float(data.get("f167"))
    mv = safe_float(data.get("f116"))
    quote: Dict[str, float] = {}
    if pe_raw is not None:
        quote["pe"] = pe_raw / 100 if abs(pe_raw) > 10 else pe_raw
    if pb_raw is not None:
        quote["pb"] = pb_raw / 100 if abs(pb_raw) > 10 else pb_raw
    if mv is not None:
        quote["market_cap"] = mv
    return quote if quote else None


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        payload = {}

    symbol = str(payload.get("symbol") or "").strip()
    base_symbol = symbol[-6:]  # 假定输入 A 股 6 位代码
    em_symbol = format_em_symbol(base_symbol)
    result = {
        "pe": 0,
        "pe_ttm": 0,
        "pb": 0,
        "roe": 0,
        "roa": 0,
        "growth": 0,
        "net_margin": 0,
        "gross_margin": 0,
        "debt_ratio": 0,
        "current_ratio": 0,
        "quick_ratio": 0,
        "ps": 0,
        "market_cap": 0,
        "fundamental_score": 0,
        "valuation_score": 0,
        "growth_score": 0,
        "risk_level": "中等"
    }
    if not symbol:
        print(json.dumps(result, ensure_ascii=False))
        return

    try:
        import akshare as ak  # type: ignore
    except Exception as e:
        result["error"] = f"akshare import failed: {e}"
        print(json.dumps(result, ensure_ascii=False))
        return

    revenue_val: Optional[float] = None

    try:
        df = ak.stock_financial_abstract(base_symbol)
        bs = ak.stock_balance_sheet_by_report_em(em_symbol)
        is_df = ak.stock_profit_sheet_by_report_em(em_symbol)
        cf = ak.stock_cash_flow_sheet_by_report_em(em_symbol)

        main_row = get_latest_row(df)
        bs_row = get_latest_row(bs)
        is_row = get_latest_row(is_df)
        # cf_row 暂未直接使用，如需现金流比率可扩展
        _ = get_latest_row(cf)

        # 财务摘要（行转列）读取 ROE/ROA/毛利率/净利率等
        roe_val = extract_from_abstract(df, ["净资产收益率", "roe"])
        roa_val = extract_from_abstract(df, ["总资产报酬率", "roa"])
        gross_margin_val = extract_from_abstract(df, ["毛利率"])
        net_margin_val = extract_from_abstract(df, ["销售净利率", "净利率"])
        market_cap_val = extract_from_abstract(df, ["总市值", "市值", "market_cap"])
        growth_val = extract_from_abstract(df, ["净利润同比增长", "净利润同比增长率", "归母净利润同比增长"])
        pe_val = None
        pb_val = None
        pe_ttm_val = None

        # 利用资产负债表计算资产负债率、流动比率、速动比率
        total_assets = extract_metric(bs_row, ["资产总计", "总资产", "total_assets"])
        total_liab = extract_metric(bs_row, ["负债合计", "总负债", "total_liabilities"])
        current_assets = extract_metric(bs_row, ["流动资产合计", "流动资产", "total_current_assets"])
        current_liab = extract_metric(bs_row, ["流动负债合计", "流动负债", "total_current_liab"])
        inventory = extract_metric(bs_row, ["存货", "库存", "inventory"]) or 0

        debt_ratio = safe_div(total_liab, total_assets)
        current_ratio = safe_div(current_assets, current_liab)
        quick_ratio = safe_div(
            (current_assets - inventory) if current_assets is not None else None,
            current_liab
        )

        # PS = 市值 / 营收
        revenue_val = extract_metric(is_row, ["营业总收入", "营业收入", "total_operate_income", "operate_income"])
        ps_val = safe_div(market_cap_val, revenue_val)

        # ROE/ROA 若缺失，用财报推算
        if (roe_val is None or roa_val is None) and is_row:
            net_profit = extract_metric(is_row, ["净利润", "归母净利润", "归属于母公司所有者的净利润", "parent_netprofit", "netprofit"])
            if roe_val is None:
                parent_equity = extract_metric(bs_row, ["股东权益合计", "归属于母公司股东权益合计", "total_parent_equity"])
                roe_val = safe_div(net_profit, parent_equity)
                if roe_val is not None:
                    roe_val = roe_val * 100
            if roa_val is None:
                roa_val = safe_div(net_profit, total_assets)
                if roa_val is not None:
                    roa_val = roa_val * 100  # 转为百分比

        # 毛利率/净利率缺失时用利润表计算
        if gross_margin_val is None and is_row and revenue_val:
            operate_cost = extract_metric(is_row, ["营业成本", "operate_cost"])
            if operate_cost is not None:
                gross_margin_val = safe_div(revenue_val - operate_cost, revenue_val)
                if gross_margin_val is not None:
                    gross_margin_val = gross_margin_val * 100
        if net_margin_val is None and is_row and revenue_val:
            net_profit = extract_metric(is_row, ["净利润", "归母净利润", "归属于母公司所有者的净利润", "parent_netprofit", "netprofit"])
            net_margin_val = safe_div(net_profit, revenue_val)
            if net_margin_val is not None:
                net_margin_val = net_margin_val * 100

        # 增长率优先用利润表同比（百分比）
        if growth_val is None and is_row:
            growth_val = extract_metric(is_row, ["parent_netprofit_yoy", "netprofit_yoy", "total_operate_income_yoy", "operate_income_yoy"])
            if growth_val is not None:
                growth_val = growth_val / 100 if abs(growth_val) > 1 else growth_val

        # 赋值
        if pe_val is not None:
            result["pe"] = pe_val
        if pe_ttm_val is not None:
            result["pe_ttm"] = pe_ttm_val
        if pb_val is not None:
            result["pb"] = pb_val
        if roe_val is not None:
            result["roe"] = roe_val
        if roa_val is not None:
            result["roa"] = roa_val
        if gross_margin_val is not None:
            result["gross_margin"] = gross_margin_val
        if net_margin_val is not None:
            result["net_margin"] = net_margin_val
        if market_cap_val is not None:
            result["market_cap"] = market_cap_val
        if growth_val is not None:
            result["growth"] = growth_val
        if debt_ratio is not None:
            result["debt_ratio"] = debt_ratio * 100  # 百分比
        if current_ratio is not None:
            result["current_ratio"] = current_ratio
        if quick_ratio is not None:
            result["quick_ratio"] = quick_ratio
        if ps_val is not None:
            result["ps"] = ps_val

    except Exception as e:
        # 保持兜底输出，不抛异常
        result["error"] = f"akshare fetch failed: {e}"

    # 若仍缺关键字段，尝试从实时行情快照补齐
    if result.get("pe") == 0 or result.get("pb") == 0 or result.get("market_cap") == 0:
        try:
            fill_from_spot(base_symbol, result)
        except Exception as e:
            # 避免兜底再度抛错
            result["error"] = result.get("error") or f"fill_from_spot failed: {e}"

    # 兜底后若拿到市值且 PS 仍为 0，可根据营收计算
    if (result.get("ps") == 0 or result.get("ps") is None) and revenue_val:
        ps_val = safe_div(result.get("market_cap"), revenue_val)
        if ps_val is not None:
            result["ps"] = ps_val

    # 简易评分与风险等级（与 Python 端风格对齐）
    fundamental_score = 6.0
    valuation_score = 6.0
    growth_score = 6.0

    if result.get("pe") and result["pe"] < 10:
        valuation_score += 1
    if result.get("pb") and result["pb"] < 1.2:
        valuation_score += 0.5
    if result.get("roe") and result["roe"] > 10:
        fundamental_score += 1
    if result.get("growth") and result["growth"] > 0.1:
        growth_score += 1

    result["fundamental_score"] = min(fundamental_score, 10)
    result["valuation_score"] = min(valuation_score, 10)
    result["growth_score"] = min(growth_score, 10)

    # 风险等级：资产负债率高则风险高
    debt_ratio_val = result.get("debt_ratio") or 0
    if debt_ratio_val > 70:
        risk_level = "高"
    elif debt_ratio_val > 50:
        risk_level = "中"
    else:
        risk_level = "低"
    result["risk_level"] = risk_level

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

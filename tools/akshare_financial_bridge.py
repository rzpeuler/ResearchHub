"""Local HTTP bridge for the ResearchHub AKShare Financial Plugin.

Run with:
    python -m uvicorn tools.akshare_financial_bridge:app --host 127.0.0.1 --port 8000

The bridge owns the Python/AKShare runtime. ResearchHub only sees the
normalized JSON contract at POST /financial.
"""

from __future__ import annotations

import math
import os
import re
from datetime import date, datetime
from typing import Any, Literal

import akshare as ak
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="ResearchHub AKShare Financial Bridge", version="1.0.0")

STATEMENT_TYPES = ("income", "balance-sheet", "cash-flow")
SYMBOL_RE = re.compile(r"^\d{6}$")


class FinancialRequest(BaseModel):
    symbol: str
    statementTypes: list[str] = Field(default_factory=lambda: list(STATEMENT_TYPES))
    periodType: Literal["annual", "quarterly", "ttm"] | None = None


class RequiredPeriodError(ValueError):
    """Raised when a source row has no usable required financial period."""


class ProviderDataError(ValueError):
    """Raised when the provider returns no usable rows."""


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "akshare"}


@app.post("/financial")
def financial(request: FinancialRequest) -> dict[str, Any]:
    symbol = request.symbol.strip()
    if not SYMBOL_RE.fullmatch(symbol):
        raise HTTPException(status_code=400, detail="symbol must be a six-digit A-share code")

    requested = list(dict.fromkeys(request.statementTypes))
    if not requested or any(item not in STATEMENT_TYPES for item in requested):
        raise HTTPException(status_code=400, detail="unsupported statementTypes")
    if request.periodType == "ttm":
        raise HTTPException(status_code=422, detail="Unsupported periodType: ttm")
    # Keep omission distinct from an explicit annual/quarterly request. The
    # omitted form must use the newest available financial period, regardless
    # of whether that period is annual or quarterly.
    period_type = request.periodType

    try:
        statements = [_fetch_statement(symbol, statement_type, period_type) for statement_type in requested]
    except RequiredPeriodError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProviderDataError as exc:
        print(f"AKShare returned no usable data for {symbol}: {exc}")
        raise HTTPException(status_code=502, detail="AKShare data request returned no usable data") from exc
    except Exception as exc:  # AKShare exceptions vary by endpoint and release.
        print(f"AKShare request failed for {symbol}: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=502, detail="AKShare data request failed") from exc

    return {"data": {"statements": statements}}


def _fetch_statement(
    symbol: str,
    statement_type: str,
    period_type: Literal["annual", "quarterly"] | None,
) -> dict[str, Any]:
    stock = ("sh" if symbol.startswith("6") else "bj" if symbol.startswith(("4", "8")) else "sz") + symbol
    start_year = os.getenv("AKSHARE_START_YEAR", "2020")

    if statement_type == "income":
        report = _latest_row(ak.stock_financial_report_sina(stock=stock, symbol="利润表"), "报告日", period_type)
        report_period = _date_text(_first_value(report, "报告日", "日期"), required=True)
        indicator = _row_for_period(
            ak.stock_financial_analysis_indicator(symbol=symbol, start_year=start_year),
            "日期",
            report_period,
        )
        values = _clean_row(report)
        values.update(_financial_indicator_values(indicator, report))
    elif statement_type == "balance-sheet":
        report = _latest_row(ak.stock_financial_report_sina(stock=stock, symbol="资产负债表"), "报告日", period_type)
        values = _clean_row(report)
        values.update(
            {
                "total_assets": _first_value(report, "资产总计"),
                "total_liab": _first_value(report, "负债合计"),
            }
        )
    else:
        report = _latest_row(ak.stock_financial_report_sina(stock=stock, symbol="现金流量表"), "报告日", period_type)
        values = _clean_row(report)
        values["n_cashflow_act"] = _first_value(report, "经营活动产生的现金流量净额")

    period = _date_text(_first_value(report, "报告日", "日期"), required=True)
    report_date = _date_text(_first_value(report, "公告日期"), required=False)
    return {
        "statementType": statement_type,
        "symbol": symbol,
        "period": period,
        "report_date": report_date,
        **values,
    }


def _financial_indicator_values(indicator: dict[str, Any] | None, report: dict[str, Any]) -> dict[str, Any]:
    revenue = _first_value(report, "营业收入", "营业总收入")
    net_profit = _first_value(report, "归属于母公司所有者的净利润", "净利润")
    gross_margin = _first_value(indicator or {}, "销售毛利率(%)")
    if gross_margin is None and revenue and _first_value(report, "营业成本") is not None:
        gross_margin = (float(revenue) - float(_first_value(report, "营业成本"))) / float(revenue) * 100

    values: dict[str, Any] = {
        "total_revenue": revenue,
        "n_income": net_profit,
        "gross_margin": gross_margin,
    }
    if indicator is not None:
        values.update(
            {
                "netprofit_margin": _first_value(indicator, "销售净利率(%)"),
                "eps": _first_value(indicator, "摊薄每股收益(元)", "加权每股收益(元)", "基本每股收益"),
                "current_ratio": _first_value(indicator, "流动比率"),
                "quick_ratio": _first_value(indicator, "速动比率"),
                "debt_to_assets": _first_value(indicator, "资产负债率(%)"),
            }
        )
    return {key: value for key, value in values.items() if value is not None}


def _row_for_period(frame: pd.DataFrame, date_column: str, target_period: str) -> dict[str, Any] | None:
    if frame is None or frame.empty:
        return None
    rows = frame.copy()
    period_values = rows.apply(
        lambda row: _first_value(row.to_dict(), date_column, "报告日", "日期", "period", "end_date"),
        axis=1,
    )
    rows["__period_date"] = pd.to_datetime(period_values, errors="coerce")
    rows = rows.loc[rows["__period_date"].notna()].copy()
    target = pd.to_datetime(target_period, errors="coerce")
    if rows.empty or pd.isna(target):
        return None
    rows = rows.loc[rows["__period_date"].dt.date.eq(target.date())].copy()
    if rows.empty:
        return None
    return rows.sort_values("__period_date", ascending=False).iloc[0].to_dict()


def _latest_row(
    frame: pd.DataFrame,
    date_column: str,
    period_type: Literal["annual", "quarterly"] | None,
) -> dict[str, Any]:
    if frame is None or frame.empty:
        raise ProviderDataError("AKShare returned no rows")
    rows = frame.copy()
    period_values = rows.apply(
        lambda row: _first_value(row.to_dict(), date_column, "报告日", "日期", "period", "end_date"),
        axis=1,
    )
    rows["__period_date"] = pd.to_datetime(period_values, errors="coerce")
    rows = rows.loc[rows["__period_date"].notna()].copy()
    if rows.empty:
        raise RequiredPeriodError("missing or invalid required financial period")
    if period_type == "annual":
        rows = rows.loc[rows["__period_date"].dt.month.eq(12)].copy()
    elif period_type == "quarterly":
        rows = rows.loc[rows["__period_date"].dt.month.isin({3, 6, 9})].copy()
    if rows.empty:
        if period_type is None:
            raise RequiredPeriodError("no valid financial period available")
        raise RequiredPeriodError(f"no {period_type} financial period available")
    rows = rows.sort_values("__period_date", ascending=False, na_position="last")
    return rows.iloc[0].to_dict()


def _first_value(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in row:
            value = _clean_value(row[name])
            if value is not None:
                return value
    return None


def _clean_row(row: dict[str, Any]) -> dict[str, Any]:
    return {str(key): _clean_value(value) for key, value in row.items() if not str(key).startswith("__")}


def _clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if pd.isna(value):
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return _clean_value(value.item())
        except (TypeError, ValueError):
            pass
    return value


def _date_text(value: Any, *, required: bool) -> str | None:
    cleaned = _clean_value(value)
    if cleaned is None:
        if required:
            raise RequiredPeriodError("missing required financial period")
        return None
    text = str(cleaned).strip()
    parsed = pd.to_datetime(text, errors="coerce")
    if pd.isna(parsed):
        if required:
            raise RequiredPeriodError("invalid required financial period")
        return None
    return parsed.date().isoformat()

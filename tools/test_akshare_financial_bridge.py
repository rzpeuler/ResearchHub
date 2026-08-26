import math
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException

from tools import akshare_financial_bridge as bridge


def frame(*rows: dict) -> pd.DataFrame:
    return pd.DataFrame(list(rows))


def annual_report(statement_date: str = "2025-12-31", **values: object) -> pd.DataFrame:
    return frame({"报告日": statement_date, **values})


class AkShareFinancialBridgeTests(unittest.TestCase):
    def test_valid_symbol_and_income_normalization(self) -> None:
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=annual_report(
            营业收入=1000, 归属于母公司所有者的净利润=250,
        )), patch.object(bridge.ak, "stock_financial_analysis_indicator", return_value=frame(
            {"日期": "2025-12-31", "销售毛利率(%)": 40, "销售净利率(%)": 25},
        )):
            result = bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"]))

        statement = result["data"]["statements"][0]
        self.assertEqual(statement["symbol"], "600519")
        self.assertEqual(statement["statementType"], "income")
        self.assertEqual(statement["period"], "2025-12-31")
        self.assertEqual(statement["total_revenue"], 1000)
        self.assertIsNone(statement["report_date"])

    def test_invalid_symbol_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as error:
            bridge.financial(bridge.FinancialRequest(symbol="ABC123"))
        self.assertEqual(error.exception.status_code, 400)

    def test_unsupported_statement_type_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as error:
            bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income", "unknown"]))
        self.assertEqual(error.exception.status_code, 400)

    def test_requested_statement_types_are_honored(self) -> None:
        def report(*, stock: str, symbol: str) -> pd.DataFrame:
            return annual_report(total_assets=5000, 负债合计=2000) if symbol == "资产负债表" else annual_report(经营活动产生的现金流量净额=400)

        with patch.object(bridge.ak, "stock_financial_report_sina", side_effect=report):
            result = bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["balance-sheet", "cash-flow"]))

        self.assertEqual([item["statementType"] for item in result["data"]["statements"]], ["balance-sheet", "cash-flow"])

    def test_balance_sheet_and_cash_flow_normalization(self) -> None:
        def report(*, stock: str, symbol: str) -> pd.DataFrame:
            if symbol == "资产负债表":
                return annual_report(资产总计=5000, 负债合计=2000)
            return annual_report(经营活动产生的现金流量净额=400)

        with patch.object(bridge.ak, "stock_financial_report_sina", side_effect=report):
            result = bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["balance-sheet", "cash-flow"]))

        balance, cash_flow = result["data"]["statements"]
        self.assertEqual(balance["total_assets"], 5000)
        self.assertEqual(balance["total_liab"], 2000)
        self.assertEqual(cash_flow["n_cashflow_act"], 400)

    def test_annual_period_selection(self) -> None:
        reports = frame(
            {"报告日": "2025-09-30", "营业收入": 900},
            {"报告日": "2025-12-31", "营业收入": 1000},
        )
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=reports), patch.object(
            bridge.ak, "stock_financial_analysis_indicator", return_value=frame({"日期": "2025-12-31"})
        ):
            result = bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"], periodType="annual"))
        self.assertEqual(result["data"]["statements"][0]["period"], "2025-12-31")

    def test_omitted_period_selects_latest_valid_period_without_filtering(self) -> None:
        rows = frame(
            {"period": "2025-12-31", "value": 1000},
            {"period": "2026-03-31", "value": 1100},
            {"period": "2026-06-30", "value": 1200},
            {"period": "not-a-date", "value": 9999},
        )

        selected = bridge._latest_row(rows, "missing", None)

        self.assertEqual(selected["period"], "2026-06-30")
        self.assertEqual(selected["value"], 1200)

    def test_financial_request_without_period_type_uses_latest_report(self) -> None:
        reports = frame(
            {"报告日": "2025-12-31", "营业收入": 1000},
            {"报告日": "2026-03-31", "营业收入": 1100},
            {"报告日": "2026-06-30", "营业收入": 1200},
        )
        indicators = frame(
            {"日期": "2025-12-31", "销售毛利率(%)": 40},
            {"日期": "2026-03-31", "销售毛利率(%)": 41},
            {"日期": "2026-06-30", "销售毛利率(%)": 42},
        )
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=reports), patch.object(
            bridge.ak, "stock_financial_analysis_indicator", return_value=indicators
        ):
            result = bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"]))

        statement = result["data"]["statements"][0]
        self.assertEqual(statement["period"], "2026-06-30")
        self.assertEqual(statement["gross_margin"], 42)

    def test_indicator_values_match_selected_report_period(self) -> None:
        reports = frame(
            {"报告日": "2025-12-31", "营业收入": 1000},
            {"报告日": "2026-06-30", "营业收入": 1200},
        )
        indicators = frame(
            {"日期": "2025-12-31", "销售净利率(%)": 10, "摊薄每股收益(元)": 1},
            {"日期": "2026-06-30", "销售净利率(%)": 12, "摊薄每股收益(元)": 2},
        )
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=reports), patch.object(
            bridge.ak, "stock_financial_analysis_indicator", return_value=indicators
        ):
            result = bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"]))

        statement = result["data"]["statements"][0]
        self.assertEqual(statement["period"], "2026-06-30")
        self.assertEqual(statement["netprofit_margin"], 12)
        self.assertEqual(statement["eps"], 2)

    def test_missing_indicator_period_does_not_fallback_to_another_period(self) -> None:
        reports = frame(
            {"报告日": "2026-03-31", "营业收入": 1000, "营业成本": 800},
            {"报告日": "2026-06-30", "营业收入": 1200, "营业成本": 900},
        )
        indicators = frame({"日期": "2026-03-31", "销售净利率(%)": 20})
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=reports), patch.object(
            bridge.ak, "stock_financial_analysis_indicator", return_value=indicators
        ):
            result = bridge.financial(
                bridge.FinancialRequest(symbol="600519", statementTypes=["income"], periodType="quarterly")
            )

        statement = result["data"]["statements"][0]
        self.assertEqual(statement["period"], "2026-06-30")
        self.assertEqual(statement["gross_margin"], 25)
        self.assertNotIn("netprofit_margin", statement)

    def test_quarterly_period_selection(self) -> None:
        reports = frame(
            {"报告日": "2025-12-31", "营业收入": 1000},
            {"报告日": "2025-09-30", "营业收入": 900},
        )
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=reports), patch.object(
            bridge.ak, "stock_financial_analysis_indicator", return_value=frame({"日期": "2025-09-30"})
        ):
            result = bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"], periodType="quarterly"))
        self.assertEqual(result["data"]["statements"][0]["period"], "2025-09-30")
        self.assertEqual(result["data"]["statements"][0]["total_revenue"], 900)

    def test_ttm_is_explicitly_unsupported(self) -> None:
        with self.assertRaises(HTTPException) as error:
            bridge.financial(bridge.FinancialRequest(symbol="600519", periodType="ttm"))
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(error.exception.detail, "Unsupported periodType: ttm")

    def test_missing_required_period_is_rejected(self) -> None:
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=frame({"营业收入": 1000})):
            with self.assertRaises(HTTPException) as error:
                bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"]))
        self.assertEqual(error.exception.status_code, 422)
        self.assertIn("required financial period", error.exception.detail)

    def test_empty_provider_data_is_controlled_error(self) -> None:
        with patch.object(bridge.ak, "stock_financial_report_sina", return_value=pd.DataFrame()):
            with self.assertRaises(HTTPException) as error:
                bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"]))
        self.assertEqual(error.exception.status_code, 502)

    def test_provider_exception_is_controlled_error(self) -> None:
        with patch.object(bridge.ak, "stock_financial_report_sina", side_effect=RuntimeError("upstream unavailable")):
            with self.assertRaises(HTTPException) as error:
                bridge.financial(bridge.FinancialRequest(symbol="600519", statementTypes=["income"]))
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(error.exception.detail, "AKShare data request failed")

    def test_cleaning_handles_nan_and_pandas_timestamp(self) -> None:
        cleaned = bridge._clean_row({"nan": math.nan, "infinite": math.inf, "timestamp": pd.Timestamp("2025-12-31")})
        self.assertIsNone(cleaned["nan"])
        self.assertIsNone(cleaned["infinite"])
        self.assertEqual(cleaned["timestamp"], "2025-12-31T00:00:00")


if __name__ == "__main__":
    unittest.main()

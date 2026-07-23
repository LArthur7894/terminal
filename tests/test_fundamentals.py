import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server


class TestNormalizeFundamentals(unittest.TestCase):
    def _sample_node(self):
        # Extrait réaliste de quoteSummary.result[0] (objets {raw, fmt} comme Yahoo).
        return {
            "price": {
                "currency": "USD",
                "longName": "Apple Inc.",
                "marketCap": {"raw": 3200000000000, "fmt": "3.2T"},
            },
            "summaryDetail": {
                "trailingPE": {"raw": 28.5, "fmt": "28.50"},
                "forwardPE": {"raw": 25.1, "fmt": "25.10"},
                "dividendYield": {"raw": 0.005, "fmt": "0.50%"},
                "payoutRatio": {"raw": 0.16, "fmt": "16.00%"},
                "priceToSalesTrailing12Months": {"raw": 7.8, "fmt": "7.80"},
            },
            "defaultKeyStatistics": {
                "pegRatio": {"raw": 2.1, "fmt": "2.10"},
                "priceToBook": {"raw": 45.2, "fmt": "45.20"},
                "enterpriseToEbitda": {"raw": 21.0, "fmt": "21.00"},
                "trailingEps": {"raw": 6.4, "fmt": "6.40"},
                "forwardEps": {"raw": 7.1, "fmt": "7.10"},
            },
            "financialData": {
                "profitMargins": {"raw": 0.25, "fmt": "25.00%"},
                "operatingMargins": {"raw": 0.30, "fmt": "30.00%"},
                "grossMargins": {"raw": 0.45, "fmt": "45.00%"},
                "returnOnEquity": {"raw": 1.47, "fmt": "147.00%"},
                "returnOnAssets": {"raw": 0.22, "fmt": "22.00%"},
                "revenueGrowth": {"raw": 0.08, "fmt": "8.00%"},
                "earningsGrowth": {"raw": 0.11, "fmt": "11.00%"},
                "debtToEquity": {"raw": 150.0, "fmt": "150.00"},
                "currentRatio": {"raw": 1.0, "fmt": "1.00"},
                "quickRatio": {"raw": 0.9, "fmt": "0.90"},
                "recommendationKey": "buy",
                "targetMeanPrice": {"raw": 250.0, "fmt": "250.00"},
            },
            "assetProfile": {
                "sector": "Technology",
                "industry": "Consumer Electronics",
            },
        }

    def test_extracts_all_fields(self):
        out = server._normalize_fundamentals("AAPL", self._sample_node())
        self.assertEqual(out["symbol"], "AAPL")
        self.assertEqual(out["currency"], "USD")
        self.assertEqual(out["longName"], "Apple Inc.")
        self.assertEqual(out["marketCap"], 3200000000000.0)
        self.assertEqual(out["trailingPE"], 28.5)
        self.assertEqual(out["pegRatio"], 2.1)
        self.assertEqual(out["priceToBook"], 45.2)
        self.assertEqual(out["profitMargins"], 0.25)
        self.assertEqual(out["returnOnEquity"], 1.47)
        self.assertEqual(out["debtToEquity"], 150.0)
        self.assertEqual(out["dividendYield"], 0.005)
        self.assertEqual(out["recommendationKey"], "buy")

    def test_extracts_sector(self):
        out = server._normalize_fundamentals("AAPL", self._sample_node())
        self.assertEqual(out["sector"], "Technology")
        self.assertEqual(out["industry"], "Consumer Electronics")

    def test_sector_absent_returns_none(self):
        node = self._sample_node()
        del node["assetProfile"]
        out = server._normalize_fundamentals("AAPL", node)
        self.assertIsNone(out["sector"])
        self.assertIsNone(out["industry"])

    def test_missing_fields_become_none(self):
        node = {"price": {"currency": "EUR"}}  # tout le reste absent
        out = server._normalize_fundamentals("MC.PA", node)
        self.assertEqual(out["symbol"], "MC.PA")
        self.assertEqual(out["currency"], "EUR")
        self.assertIsNone(out["trailingPE"])
        self.assertIsNone(out["profitMargins"])
        self.assertIsNone(out["debtToEquity"])
        self.assertIsNone(out["recommendationKey"])

    def test_pick_handles_raw_and_scalar_and_bad(self):
        self.assertEqual(server._pick({"x": {"raw": 12.5}}, "x"), 12.5)
        self.assertEqual(server._pick({"x": 3}, "x"), 3.0)
        self.assertIsNone(server._pick({"x": {"fmt": "N/A"}}, "x"))  # pas de raw
        self.assertIsNone(server._pick({}, "x"))
        self.assertIsNone(server._pick({"x": None}, "x"))

    def test_dividend_rate_extracted(self):
        node = self._sample_node()
        node["summaryDetail"]["dividendRate"] = {"raw": 0.96, "fmt": "0.96"}
        out = server._normalize_fundamentals("AAPL", node)
        self.assertEqual(out["dividendRate"], 0.96)

    def test_dividend_rate_fallback_and_absent(self):
        # repli sur trailingAnnualDividendRate quand dividendRate absent
        node = self._sample_node()
        node["summaryDetail"]["trailingAnnualDividendRate"] = {"raw": 0.9, "fmt": "0.90"}
        out = server._normalize_fundamentals("AAPL", node)
        self.assertEqual(out["dividendRate"], 0.9)
        # absent des deux → None
        out2 = server._normalize_fundamentals("MC.PA", {"price": {"currency": "EUR"}})
        self.assertIsNone(out2["dividendRate"])


if __name__ == "__main__":
    unittest.main()

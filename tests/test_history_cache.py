import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server


class TestHistoryCache(unittest.TestCase):
    def setUp(self):
        server._HISTORY_CACHE.clear()

    tearDown = setUp

    def _payload(self, n=3):
        return {"dates": [f"2026-01-{i + 1:02d}" for i in range(n)],
                "closes": [100.0 + i for i in range(n)], "currency": "USD"}

    def test_absent_returns_none(self):
        self.assertIsNone(server._history_cache_get("AAPL"))

    def test_put_then_get(self):
        p = self._payload()
        server._history_cache_put("AAPL", p)
        self.assertEqual(server._history_cache_get("AAPL"), p)

    def test_symbols_are_independent(self):
        server._history_cache_put("AAPL", self._payload(3))
        server._history_cache_put("MC.PA", self._payload(5))
        self.assertEqual(len(server._history_cache_get("AAPL")["closes"]), 3)
        self.assertEqual(len(server._history_cache_get("MC.PA")["closes"]), 5)

    def test_expired_entry_is_dropped(self):
        server._HISTORY_CACHE["AAPL"] = (time.time() - 1, self._payload())
        self.assertIsNone(server._history_cache_get("AAPL"))
        self.assertNotIn("AAPL", server._HISTORY_CACHE)  # purgée, pas seulement ignorée

    def test_size_stays_bounded(self):
        # Au-delà du plafond, l'insertion doit faire de la place au lieu de gonfler sans fin.
        for i in range(server._HISTORY_CACHE_MAX + 50):
            server._history_cache_put(f"SYM{i}", self._payload(1))
        self.assertLessEqual(len(server._HISTORY_CACHE), server._HISTORY_CACHE_MAX)

    def test_eviction_prefers_expired_entries(self):
        for i in range(server._HISTORY_CACHE_MAX):
            server._HISTORY_CACHE[f"OLD{i}"] = (time.time() - 1, self._payload(1))
        server._history_cache_put("FRAIS", self._payload(1))
        self.assertIsNotNone(server._history_cache_get("FRAIS"))
        self.assertIsNone(server._history_cache_get("OLD0"))


class TestLogMessageAcceptsNonStrings(unittest.TestCase):
    """log_error() passe un code HTTP entier en premier argument : le journal ne doit
    pas lever d'exception, sous peine de tuer le fil de la requête (toute réponse 404
    se terminait par une connexion fermée sans réponse)."""

    def test_int_first_arg_does_not_raise(self):
        handler = server.Handler.__new__(server.Handler)     # sans passer par __init__ (pas de socket)
        handler.address_string = lambda: "127.0.0.1"
        handler.log_message("code %d, message %s", 404, "Not Found")   # ne doit pas lever

    def test_api_request_line_is_logged(self):
        handler = server.Handler.__new__(server.Handler)
        handler.address_string = lambda: "127.0.0.1"
        handler.log_message('"%s" %s %s', "GET /api/history?symbol=AAPL HTTP/1.1", "200", "-")


if __name__ == "__main__":
    unittest.main()

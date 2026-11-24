import tempfile
import unittest
from pathlib import Path
from unittest import mock

from lottery import jackpots, sources, storage
from lottery.games import GAMES


def page(body: str) -> str:
    return f"<html><body><script>var x='Lotto 01/01/2000 Sat Info 1 2 3 4 5 6 7';</script>{body}" \
           "<p>See the results of other games.</p><p>Lotto 01/01/1999 Sat Info 1 2 3 4 5 6 7</p></body></html>"


class ParserTests(unittest.TestCase):
    def test_lotto(self):
        html = page("<tr class='cy'><td class='cx'>Lotto &nbsp; 21/11/2026 Sat &nbsp; <a>Info</a></tr>"
                    "<ul><li>41<li>15<li>19<li>23<li>34<li>11<li class='dbx'> <li>38</ul>")
        d = sources.parse_lotteryextreme(GAMES["lotto"], html)
        self.assertEqual(d, [{"date": "2026-11-21", "main": [11, 15, 19, 23, 34, 41], "extra": [38]}])

    def test_keno(self):
        nums = " ".join(f"<li>{n}" for n in range(1, 21))
        d = sources.parse_lotteryextreme(GAMES["keno"], page(f"Keno &nbsp; 01/10/2026 Thu <ul>{nums}</ul>"))
        self.assertEqual(len(d), 1)
        self.assertEqual(d[0]["main"], list(range(1, 21)))

    def test_pick3_keeps_order(self):
        d = sources.parse_lotteryextreme(GAMES["pick3"], page("Pick 3 &nbsp; 02.09.2002 Mon <li>4<li>2<li>2"))
        self.assertEqual(d[0]["main"], [4, 2, 2])

    def test_jokerplus(self):
        d = sources.parse_lotteryextreme(GAMES["jokerplus"], page("<td>5133</td><td>22/11/2026 Sun</td><td>2 9 8 1 8 4</td><td>Waterman</td>"))
        self.assertEqual(d, [{"date": "2026-11-22", "draw": 5133, "main": [2, 9, 8, 1, 8, 4], "extra": [], "sign": "Waterman"}])

    def test_eurodreams(self):
        d = sources.parse_lotteryextreme(GAMES["eurodreams"], page("Mon, November 6 (06/11/2023) (1) &nbsp; Winners <li>35<li>13<li>14<li>25<li>30<li>10<li>5"))
        self.assertEqual(d[0]["main"], [10, 13, 14, 25, 30, 35])
        self.assertEqual(d[0]["extra"], [5])
        self.assertEqual(d[0]["draw"], 1)

    def test_vikinglotto_without_viking_number_is_skipped(self):
        d = sources.parse_lotteryextreme(GAMES["vikinglotto"], page("Viking Lotto 17.03.1993 5 18 24 26 38 40 (C)2009"))
        self.assertEqual(d, [])

    def test_euromillions(self):
        row = ('<tr class="resultRow"><td><a href="/results/31-12-2004">x</a></td><td><ul class="balls">'
               + "".join(f'<li class="resultBall ball small">{n}</li>' for n in (7, 8, 24, 25, 47))
               + '<li class="resultBall lucky-star small">9</li><li class="resultBall lucky-star small">8</li></ul></td></tr>')
        d = sources.parse_euromillions_year(GAMES["euromillions"], row)
        self.assertEqual(d, [{"date": "2004-12-31", "main": [7, 8, 24, 25, 47], "extra": [8, 9]}])

    def test_injection_text_is_never_accepted(self):
        html = page("Lotto 21/11/2026 Sat Info <script>alert(1)</script> 1 2 3 4 5 6 7 "
                    "<img src=x onerror=alert(1)>")
        for d in sources.parse_lotteryextreme(GAMES["lotto"], html):
            self.assertTrue(all(isinstance(n, int) for n in d["main"] + d["extra"]))


class ValidationTests(unittest.TestCase):
    def test_rejects_out_of_range(self):
        with self.assertRaises(ValueError):
            sources.validate_draw(GAMES["lotto"], {"date": "2020-01-01", "main": [1, 2, 3, 4, 5, 46], "extra": [7]})

    def test_rejects_duplicates(self):
        with self.assertRaises(ValueError):
            sources.validate_draw(GAMES["lotto"], {"date": "2020-01-01", "main": [1, 1, 3, 4, 5, 6], "extra": [7]})

    def test_rejects_bad_sign_and_date(self):
        with self.assertRaises(ValueError):
            sources.validate_draw(GAMES["jokerplus"], {"date": "2020-01-01", "main": [1] * 6, "extra": [], "sign": "<b>"})
        with self.assertRaises(ValueError):
            sources.validate_draw(GAMES["pick3"], {"date": "2020-13-01", "main": [1, 2, 3], "extra": []})

    def test_only_https(self):
        with self.assertRaises(sources.SourceError):
            sources.http_fetch("http://example.com")
        with self.assertRaises(sources.SourceError):
            sources.http_fetch("file:///etc/passwd")


class StorageTests(unittest.TestCase):
    def test_roundtrip_and_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            with mock.patch.object(storage, "CSV_DIR", tmp / "csv"), mock.patch.object(storage, "JSON_DIR", tmp / "json"):
                g = GAMES["jokerplus"]
                a = [{"date": "2020-01-02", "draw": 2, "main": [1, 2, 3, 4, 5, 6], "extra": [], "sign": "Ram"}]
                b = [{"date": "2020-01-01", "draw": 1, "main": [0, 0, 0, 0, 0, 0], "extra": [], "sign": "Vissen"},
                     a[0]]
                merged, added = storage.merge(a, b)
                self.assertEqual(added, 1)
                storage.save(g, merged)
                self.assertEqual(storage.load(g), merged)
                self.assertEqual((tmp / "csv" / "jokerplus.csv").stat().st_mode & 0o777, 0o644)


class JackpotTests(unittest.TestCase):
    def test_parse_next_and_last(self):
        html = ("<div>Next draw Tuesday 24 Nov 2026</div><span>19 h : 24 m</span><p>Next Jackpot 46,000,000€</p>"
                "<h3>Past Results</h3> Friday 20 Nov 2026 <li>8<li>21<li>24<li>36<li>49<li>1<li>8 Jackpot 37,000,000€")
        self.assertEqual(jackpots.parse(html), {"nextDraw": "2026-11-24", "nextJackpot": 46000000,
                                                "lastDraw": "2026-11-20", "lastJackpot": 37000000})

    def test_parse_without_next_jackpot_and_absurd_amount(self):
        html = ("Next draw Wednesday 25 Nov 2026 1 day Visit Website Past Results Saturday 21 Nov 2026 "
                "11 15 19 23 34 41 38 Jackpot 999,999,999,999€")
        out = jackpots.parse(html)
        self.assertEqual(out["nextDraw"], "2026-11-25")
        self.assertIsNone(out["nextJackpot"])
        self.assertIsNone(out["lastJackpot"])  # onrealistisch bedrag wordt geweigerd


class EraTests(unittest.TestCase):
    """Elke opgeslagen trekking moet passen binnen de spelformule van haar datum."""

    def test_data_matches_eras(self):
        for g in GAMES.values():
            draws = storage.load(g)
            if not draws:
                continue
            self.assertTrue(g.eras, f"{g.key}: geen tijdperken gedefinieerd")
            self.assertEqual(list(g.eras), sorted(g.eras), g.key)
            self.assertEqual(g.eras[-1][1], g.main_max, g.key)
            for d in draws:
                era = [e for e in g.eras if e[0] <= d["date"]]
                self.assertTrue(era, f"{g.key} {d['date']} valt voor het eerste tijdperk")
                _, main_max, extra_max = era[-1]
                self.assertLessEqual(max(d["main"]), main_max, f"{g.key} {d['date']}")
                if d["extra"]:
                    self.assertLessEqual(max(d["extra"]), extra_max, f"{g.key} {d['date']}")


if __name__ == "__main__":
    unittest.main()

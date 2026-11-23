"""Ophalen en parsen van trekkingsresultaten uit publieke archieven.

Alleen de Python-standaardbibliotheek wordt gebruikt. Alle opgehaalde
gegevens worden strikt gevalideerd (enkel cijfers binnen het toegelaten
bereik, sterrenbeelden uit een vaste lijst) voordat ze worden opgeslagen.
"""
from __future__ import annotations

import html
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

from .games import ZODIAC_SIGNS, Game

USER_AGENT = "Mozilla/5.0 (compatible; loterij-statistieken/1.0; persoonlijk gebruik)"
TIMEOUT = 30
LOTTERYEXTREME = "https://www.lotteryextreme.com"
EUROMILLIONS_COM = "https://www.euro-millions.com"

# Beleefd scrapen: minimale pauze tussen twee verzoeken (seconden).
REQUEST_DELAY = 1.0
_last_request = 0.0

MONTHS_EN = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}


class SourceError(RuntimeError):
    pass


def _throttle() -> None:
    global _last_request
    wait = REQUEST_DELAY - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()


class _HttpsOnlyRedirects(urllib.request.HTTPRedirectHandler):
    """Volg enkel redirects die opnieuw naar HTTPS gaan."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise SourceError(f"Redirect naar niet-HTTPS adres geweigerd: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_HttpsOnlyRedirects())


def http_fetch(url: str, form: dict | None = None, retries: int = 4) -> str:
    """Haal een pagina op (GET, of POST als `form` gegeven is)."""
    if not url.startswith("https://"):
        raise SourceError("Enkel HTTPS-bronnen zijn toegelaten")
    data = urllib.parse.urlencode(form).encode() if form else None
    last_exc: Exception | None = None
    for attempt in range(retries):
        _throttle()
        req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with _opener.open(req, timeout=TIMEOUT) as resp:  # https gecontroleerd
                raw = resp.read(5_000_000)  # harde limiet van 5 MB per pagina
                return raw.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code in (400, 401, 403, 404):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last_exc = exc
        time.sleep(2 ** attempt)
    raise SourceError(f"Ophalen mislukt voor {url}: {last_exc}")


def html_to_text(page: str) -> str:
    page = re.sub(r"<(script|style)\b.*?</\1>", " ", page, flags=re.S | re.I)
    page = re.sub(r"<!--.*?-->", " ", page, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", page)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text)


# --------------------------------------------------------------------------
# Validatie
# --------------------------------------------------------------------------

def _ints(s: str) -> list[int]:
    return [int(x) for x in s.split()]


def validate_draw(game: Game, rec: dict) -> dict:
    """Controleer een trekking; geeft het record terug of gooit ValueError."""
    d = rec["date"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise ValueError(f"Ongeldige datum {d!r}")
    date.fromisoformat(d)
    main = rec["main"]
    if len(main) != game.main_count:
        raise ValueError(f"{game.key} {d}: {len(main)} hoofdgetallen i.p.v. {game.main_count}")
    lo = game.main_min
    hi = game.sanity_main_max or game.main_max
    if any(not (lo <= n <= hi) for n in main):
        raise ValueError(f"{game.key} {d}: getal buiten bereik {main}")
    if game.kind == "pool" and len(set(main)) != len(main):
        raise ValueError(f"{game.key} {d}: dubbel getal {main}")
    extra = rec.get("extra", [])
    if len(extra) != game.extra_count:
        raise ValueError(f"{game.key} {d}: {len(extra)} extra getallen i.p.v. {game.extra_count}")
    ehi = game.sanity_extra_max or game.extra_max
    if any(not (1 <= n <= ehi) for n in extra):
        raise ValueError(f"{game.key} {d}: extra getal buiten bereik {extra}")
    if game.has_sign and rec.get("sign") not in ZODIAC_SIGNS:
        raise ValueError(f"{game.key} {d}: onbekend sterrenbeeld {rec.get('sign')!r}")
    out = {"date": d, "main": list(main), "extra": list(extra)}
    if game.kind == "pool":
        out["main"] = sorted(main)
        if not game.extra_from_main_pool:
            out["extra"] = sorted(extra)
    if rec.get("draw") is not None:
        out["draw"] = int(rec["draw"])
    if game.has_sign:
        out["sign"] = rec["sign"]
    return out


# --------------------------------------------------------------------------
# lotteryextreme.com  (maandarchieven)
# --------------------------------------------------------------------------

def _dmy(s: str) -> str:
    dd, mm, yy = re.split(r"[./]", s)
    return f"{yy}-{mm}-{dd}"


_DAY = r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)"
_SIGNS = "|".join(ZODIAC_SIGNS)

PATTERNS = {
    # Lotto 21/11/2026 Sat Info 11 15 19 23 34 41 38
    "lotto": re.compile(r"Lotto (\d\d/\d\d/\d{4}) " + _DAY + r" Info ((?:\d{1,2} ){6}\d{1,2})\b"),
    # Keno 01/10/2026 Thu 2 4 9 ... (20 getallen)
    "keno": re.compile(r"Keno (\d\d/\d\d/\d{4}) " + _DAY + r" ((?:\d{1,2} ){19}\d{1,2})\b"),
    # Pick 3 02.09.2002 Mon 4 2 2
    "pick3": re.compile(r"Pick 3 (\d\d\.\d\d\.\d{4}) " + _DAY + r" (\d \d \d)\b"),
    # (06/11/2023) (1) Winners 10 13 14 25 30 35 5
    "eurodreams": re.compile(r"\((\d\d/\d\d/\d{4})\) \((\d+)\) Winners ((?:\d{1,2} ){6}\d{1,2})\b"),
    # Viking Lotto 18.11.2026 5 9 11 15 23 24 4
    "vikinglotto": re.compile(r"Viking Lotto (\d\d\.\d\d\.\d{4}) ((?:\d{1,2} ){6}\d{1,2})\b"),
    # 5133 22/11/2026 Sun 2 9 8 1 8 4 Waterman
    "jokerplus": re.compile(r"\b(\d{1,6}) (\d\d/\d\d/\d{4}) " + _DAY + r" (\d \d \d \d \d \d) (" + _SIGNS + r")\b"),
}


def _month_section(text: str) -> str:
    """Beperk tot het maandoverzicht (niet de 'laatste 20 trekkingen')."""
    end = text.find("See the results of other games")
    if end == -1:
        end = text.find("(C)2009")
    return text[: end if end != -1 else len(text)]


def parse_lotteryextreme(game: Game, page: str) -> list[dict]:
    text = _month_section(html_to_text(page))
    pat = PATTERNS[game.key]
    out = []
    for m in pat.finditer(text):
        if game.key == "eurodreams":
            nums = _ints(m.group(3))
            rec = {"date": _dmy(m.group(1)), "draw": int(m.group(2)), "main": nums[:6], "extra": nums[6:]}
        elif game.key == "jokerplus":
            rec = {"date": _dmy(m.group(2)), "draw": int(m.group(1)),
                   "main": _ints(m.group(3)), "extra": [], "sign": m.group(4)}
        else:
            nums = _ints(m.group(2))
            mc = game.main_count
            rec = {"date": _dmy(m.group(1)), "main": nums[:mc], "extra": nums[mc:]}
        out.append(validate_draw(game, rec))
    return out


def fetch_lotteryextreme_month(game: Game, year: int, month: int) -> list[dict]:
    url = LOTTERYEXTREME + game.source_path
    if game.key == "jokerplus":
        form = {"tryb": "rokmsc", "_month": str(month), "_year": str(year)}
    else:
        form = {"mode": "month", "year_month": f"{year:04d}-{month:02d}"}
    page = http_fetch(url, form)
    draws = parse_lotteryextreme(game, page)
    prefix = f"{year:04d}-{month:02d}"
    return [d for d in draws if d["date"].startswith(prefix)]


# --------------------------------------------------------------------------
# euro-millions.com  (jaararchieven)
# --------------------------------------------------------------------------

_EM_ROW = re.compile(r'<tr class="resultRow".*?</tr>', re.S)
_EM_DATE = re.compile(r'href="/results/(\d\d)-(\d\d)-(\d{4})"')
_EM_BALL = re.compile(r'<li class="resultBall (ball|lucky-star)[^"]*">\s*(\d{1,2})\s*</li>')


def parse_euromillions_year(game: Game, page: str) -> list[dict]:
    out = []
    for row in _EM_ROW.findall(page):
        dm = _EM_DATE.search(row)
        if not dm:
            continue
        balls = _EM_BALL.findall(row)
        main = [int(n) for k, n in balls if k == "ball"]
        stars = [int(n) for k, n in balls if k == "lucky-star"]
        rec = {"date": f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}", "main": main, "extra": stars}
        out.append(validate_draw(game, rec))
    return out


def fetch_euromillions_year(game: Game, year: int) -> list[dict]:
    page = http_fetch(EUROMILLIONS_COM + game.source_path.format(year=year))
    return [d for d in parse_euromillions_year(game, page) if d["date"].startswith(str(year))]


# --------------------------------------------------------------------------
# Generieke interface
# --------------------------------------------------------------------------

def periods(game: Game, start: str | None = None, end: date | None = None) -> list[tuple[int, int]]:
    """Lijst van (jaar, maand) - of (jaar, 0) voor jaarbronnen - om op te halen."""
    end = end or date.today()
    y, m = map(int, (start or game.first_month).split("-"))
    if game.source == "euromillionscom":
        return [(yy, 0) for yy in range(y, end.year + 1)]
    out = []
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def fetch_period(game: Game, year: int, month: int) -> list[dict]:
    if game.source == "euromillionscom":
        return fetch_euromillions_year(game, year)
    return fetch_lotteryextreme_month(game, year, month)

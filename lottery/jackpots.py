"""Jackpot van de volgende trekking ophalen (Lotto, EuroMillions, EuroDreams, Vikinglotto).

Bron: lotteryguru.com (Belgische spelpagina's). Niet elk spel heeft er altijd
een geraamde jackpot voor de volgende trekking; dan bewaren we de jackpot van
de vorige trekking, duidelijk als zodanig gemarkeerd.
Resultaat: data/json/jackpots.json
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from . import sources, storage

PAGES = {
    "lotto": "be-lotto",
    "euromillions": "be-euromillions",
    "eurodreams": "be-eurodreams",
    "vikinglotto": "be-vikinglotto",
}
BASE = "https://lotteryguru.com/belgium-lottery-results/"
_DAY = r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)"
_DATE = r"(\d{1,2} [A-Z][a-z]{2} \d{4})"
_AMOUNT = r"([\d,]{1,15})\s?€"

# Absurde bedragen weren (bv. door een gewijzigde pagina): tussen 100.000 en 1 miljard euro.
MIN_AMOUNT, MAX_AMOUNT = 100_000, 1_000_000_000


def _date(s: str) -> str:
    return datetime.strptime(s, "%d %b %Y").date().isoformat()


def _amount(s: str) -> int | None:
    value = int(s.replace(",", ""))
    return value if MIN_AMOUNT <= value <= MAX_AMOUNT else None


def parse(page: str) -> dict:
    text = sources.html_to_text(page)
    out: dict = {"nextDraw": None, "nextJackpot": None, "lastDraw": None, "lastJackpot": None}
    m = re.search(r"Next draw " + _DAY + " " + _DATE, text)
    if m:
        out["nextDraw"] = _date(m.group(1))
        rest = text[m.end(): m.end() + 200]
        j = re.match(r"[^€]{0,80}?Next Jackpot " + _AMOUNT, rest)
        if j:
            out["nextJackpot"] = _amount(j.group(1))
    m = re.search(r"Past Results " + _DAY + " " + _DATE + r"[\d ]{0,60}Jackpot " + _AMOUNT, text)
    if m:
        out["lastDraw"] = _date(m.group(1))
        out["lastJackpot"] = _amount(m.group(2))
    return out


def update() -> dict:
    result = {}
    for game, slug in PAGES.items():
        try:
            info = parse(sources.http_fetch(BASE + slug))
        except (sources.SourceError, ValueError) as exc:
            print(f"  ! jackpot {game}: {exc}", flush=True)
            continue
        if info["nextDraw"] or info["lastJackpot"]:
            result[game] = info
    if result:
        payload = json.dumps({"source": "lotteryguru.com", "games": result}, indent=1) + "\n"
        storage._atomic_write(storage.JSON_DIR / "jackpots.json", payload)
    return result

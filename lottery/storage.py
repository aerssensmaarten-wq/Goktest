"""Opslag van trekkingen.

Per spel worden drie vormen bijgehouden in de map `data/`:

* `data/csv/<spel>.csv`   - leesbaar in Excel / LibreOffice / Numbers (bron van waarheid)
* `data/json/<spel>.json` - gebruikt door de web-app
* `data/loterij.sqlite`   - één SQLite-database met alle spellen (tabel `trekkingen`)
"""
from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
import tempfile
from pathlib import Path

from .games import GAMES, Game
from .sources import validate_draw

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CSV_DIR = DATA / "csv"
JSON_DIR = DATA / "json"
SQLITE_PATH = DATA / "loterij.sqlite"


def _atomic_write(path: Path, content: str) -> bool:
    """Schrijf atomair; sla over als de inhoud niet veranderd is. Geeft True bij wijziging."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        os.chmod(path, 0o644)
        return False
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(content)
        os.chmod(tmp, 0o644)  # leesbaar voor de gebruiker en de webserver
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return True


def csv_header(game: Game) -> list[str]:
    cols = ["datum"]
    if game.key in ("jokerplus", "eurodreams"):
        cols.append("trekking_nr")
    label = "cijfer" if game.kind == "digits" else "getal"
    cols += [f"{label}_{i}" for i in range(1, game.main_count + 1)]
    if game.extra_count == 1:
        cols.append(game.extra_name.lower().replace("-", "_").replace(" ", "_"))
    else:
        cols += [f"ster_{i}" for i in range(1, game.extra_count + 1)]
    if game.has_sign:
        cols.append("sterrenbeeld")
    return cols


def load(game: Game) -> list[dict]:
    path = CSV_DIR / f"{game.key}.csv"
    if not path.exists():
        return []
    out = []
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header != csv_header(game):
            raise ValueError(f"Onverwachte kolommen in {path}")
        for row in reader:
            if not row:
                continue
            i = 1
            rec: dict = {"date": row[0]}
            if "trekking_nr" in header:
                rec["draw"] = int(row[1]) if row[1] else None
                i = 2
            rec["main"] = [int(x) for x in row[i:i + game.main_count]]
            i += game.main_count
            rec["extra"] = [int(x) for x in row[i:i + game.extra_count]]
            i += game.extra_count
            if game.has_sign:
                rec["sign"] = row[i]
            out.append(validate_draw(game, rec))
    return out


def merge(existing: list[dict], new: list[dict]) -> tuple[list[dict], int]:
    """Voeg nieuwe trekkingen toe (sleutel = datum [+ trekkingsnummer])."""
    def key(d):
        return (d["date"], d.get("draw") or 0)
    by_key = {key(d): d for d in existing}
    added = 0
    for d in new:
        k = key(d)
        if k not in by_key:
            added += 1
        by_key[k] = d
    merged = sorted(by_key.values(), key=key)
    return merged, added


def save(game: Game, draws: list[dict]) -> None:
    draws = sorted(draws, key=lambda d: (d["date"], d.get("draw") or 0))
    # CSV
    header = csv_header(game)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    for d in draws:
        row = [d["date"]]
        if "trekking_nr" in header:
            row.append(d.get("draw", ""))
        row += d["main"] + d["extra"]
        if game.has_sign:
            row.append(d["sign"])
        w.writerow(row)
    _atomic_write(CSV_DIR / f"{game.key}.csv", buf.getvalue())
    # JSON (compact) voor de web-app
    payload = {
        "game": game.key,
        "count": len(draws),
        "fields": ["date", "main", "extra"] + (["sign"] if game.has_sign else []),
        "draws": [
            [d["date"], d["main"], d["extra"]] + ([d["sign"]] if game.has_sign else [])
            for d in draws
        ],
    }
    # Eén trekking per regel: kleine, leesbare diffs in git bij elke update.
    head = json.dumps({k: v for k, v in payload.items() if k != "draws"}, separators=(",", ":"))[:-1]
    rows = ",\n".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) for r in payload["draws"])
    _atomic_write(JSON_DIR / f"{game.key}.json", f'{head},"draws":[\n{rows}\n]}}\n')


def write_index() -> None:
    """Overzichtsbestand met de metadata van alle spellen voor de web-app."""
    games = []
    for g in GAMES.values():
        draws = load(g)
        games.append({
            "key": g.key, "name": g.name, "kind": g.kind,
            "mainCount": g.main_count, "mainMin": g.main_min, "mainMax": g.main_max,
            "extraCount": g.extra_count, "extraMax": g.extra_max, "extraName": g.extra_name,
            "extraFromMainPool": g.extra_from_main_pool, "hasSign": g.has_sign,
            "pickCount": g.pick_count, "pickMin": g.pick_min, "pickMax": g.pick_max,
            "drawDays": g.draw_days, "description": g.description,
            "eras": [{"from": e[0], "mainMax": e[1], "extraMax": e[2]} for e in g.eras],
            "count": len(draws),
            "first": draws[0]["date"] if draws else None,
            "last": draws[-1]["date"] if draws else None,
        })
    payload = {
        "lastDraw": max((g["last"] for g in games if g["last"]), default=None),
        "games": games,
    }
    _atomic_write(JSON_DIR / "index.json", json.dumps(payload, ensure_ascii=False, indent=1))


def write_sqlite() -> None:
    """Bouw de SQLite-database opnieuw op vanuit de CSV-bestanden."""
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=SQLITE_PATH.parent, prefix=".tmp-", suffix=".sqlite")
    os.close(fd)
    try:
        con = sqlite3.connect(tmp)
        con.executescript(
            """
            CREATE TABLE spellen (
                spel TEXT PRIMARY KEY, naam TEXT NOT NULL, soort TEXT NOT NULL,
                aantal_hoofdgetallen INTEGER, hoogste_getal INTEGER,
                aantal_extra INTEGER, hoogste_extra INTEGER, naam_extra TEXT
            );
            CREATE TABLE trekkingen (
                spel TEXT NOT NULL REFERENCES spellen(spel),
                datum TEXT NOT NULL,
                trekking_nr INTEGER,
                getallen TEXT NOT NULL,      -- spaties tussen de getallen/cijfers
                extra TEXT,                  -- bonus / sterren / Viking / Dream
                sterrenbeeld TEXT,
                PRIMARY KEY (spel, datum, trekking_nr)
            );
            CREATE TABLE getallen (           -- één rij per getrokken getal (handig voor tellingen)
                spel TEXT NOT NULL, datum TEXT NOT NULL, positie INTEGER NOT NULL,
                soort TEXT NOT NULL,          -- 'hoofd' of 'extra'
                getal INTEGER NOT NULL
            );
            CREATE INDEX idx_getallen ON getallen(spel, soort, getal);
            CREATE VIEW frequentie AS
                SELECT spel, soort, getal, COUNT(*) AS aantal
                FROM getallen GROUP BY spel, soort, getal;
            """
        )
        for g in GAMES.values():
            con.execute(
                "INSERT INTO spellen VALUES (?,?,?,?,?,?,?,?)",
                (g.key, g.name, g.kind, g.main_count, g.main_max, g.extra_count, g.extra_max, g.extra_name),
            )
            rows, nums = [], []
            for d in load(g):
                rows.append((g.key, d["date"], d.get("draw"), " ".join(map(str, d["main"])),
                             " ".join(map(str, d["extra"])) or None, d.get("sign")))
                nums += [(g.key, d["date"], i + 1, "hoofd", n) for i, n in enumerate(d["main"])]
                nums += [(g.key, d["date"], i + 1, "extra", n) for i, n in enumerate(d["extra"])]
            con.executemany("INSERT OR REPLACE INTO trekkingen VALUES (?,?,?,?,?,?)", rows)
            con.executemany("INSERT INTO getallen VALUES (?,?,?,?,?)", nums)
        con.commit()
        con.execute("VACUUM")
        con.close()
        if SQLITE_PATH.exists() and SQLITE_PATH.read_bytes() == Path(tmp).read_bytes():
            return  # ongewijzigd (tmp wordt hieronder opgeruimd)
        os.chmod(tmp, 0o644)
        os.replace(tmp, SQLITE_PATH)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

"""Opdrachtregel: python -m lottery <opdracht>

  update   Haal de nieuwste trekkingen op (laatste 2 maanden) en herbereken alles.
  full     Haal de volledige historiek op (hervat waar gebleven werd).
  rebuild  Bouw JSON/SQLite opnieuw op vanuit de CSV-bestanden (geen netwerk).
  serve    Start de web-app lokaal op http://127.0.0.1:8000
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from . import sources, storage
from .games import GAMES, get_game


def _log(msg: str) -> None:
    print(msg, flush=True)


def update_game(key: str, full: bool = False, months_back: int = 2) -> int:
    game = get_game(key)
    existing = storage.load(game)
    if full:
        # Hervat vanaf de laatste bekende maand (of vanaf het begin).
        start = existing[-1]["date"][:7] if existing else game.first_month
    else:
        today = date.today()
        y, m = today.year, today.month - (months_back - 1)
        while m < 1:
            y, m = y - 1, m + 12
        start = max(f"{y:04d}-{m:02d}", game.first_month)
    periods = sources.periods(game, start)
    total_added = 0
    draws = existing
    for i, (y, m) in enumerate(periods, 1):
        try:
            new = sources.fetch_period(game, y, m)
        except (sources.SourceError, ValueError) as exc:
            _log(f"  ! {game.name} {y}-{m:02d}: {exc}")
            continue
        draws, added = storage.merge(draws, new)
        total_added += added
        if full and (i % 12 == 0 or i == len(periods)):
            storage.save(game, draws)  # tussentijds bewaren
            _log(f"  {game.name}: {y}-{m:02d} ({i}/{len(periods)}), {len(draws)} trekkingen")
    storage.save(game, draws)
    _log(f"{game.name}: {total_added} nieuwe trekking(en), totaal {len(draws)}")
    return total_added


def rebuild() -> None:
    for g in GAMES.values():
        draws = storage.load(g)
        if draws:
            storage.save(g, draws)
    storage.write_index()
    storage.write_sqlite()


SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                               "connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; "
                               "frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-cache",
}
ALLOWED_PREFIXES = ("/web/", "/data/csv/", "/data/json/", "/data/loterij.sqlite")


def make_handler():
    import http.server
    import posixpath
    import urllib.parse

    class Handler(http.server.SimpleHTTPRequestHandler):
        """Serveert enkel de web-app en de databestanden; niets anders (geen .git, broncode, ...)."""

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(storage.ROOT), **kwargs)

        def _allowed(self) -> bool:
            path = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlsplit(self.path).path))
            if any(part.startswith(".") for part in path.split("/") if part):
                return False
            if path == "/web":
                path = "/web/"
            return any(path == p or path.startswith(p) for p in ALLOWED_PREFIXES) and ".." not in path

        def do_GET(self):
            if urllib.parse.urlsplit(self.path).path in ("", "/"):
                self.send_response(302)
                self.send_header("Location", "/web/")
                self.end_headers()
                return
            if not self._allowed():
                self.send_error(404)
                return
            super().do_GET()

        def do_HEAD(self):
            if not self._allowed():
                self.send_error(404)
                return
            super().do_HEAD()

        def list_directory(self, path):  # geen mapoverzichten
            self.send_error(404)
            return None

        def end_headers(self):
            for k, v in SECURITY_HEADERS.items():
                self.send_header(k, v)
            super().end_headers()

        def log_message(self, fmt, *args):  # stil, behalve fouten
            pass

    Handler.extensions_map = {**Handler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                              ".sqlite": "application/vnd.sqlite3", ".webmanifest": "application/manifest+json", ".csv": "text/csv; charset=utf-8"}
    return Handler


def serve(port: int) -> None:
    import http.server

    # Enkel op localhost luisteren: de app is niet bedoeld om op het netwerk open te staan.
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler()) as httpd:
        _log(f"Web-app: http://127.0.0.1:{port}/web/   (Ctrl+C om te stoppen)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m lottery", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["update", "full", "rebuild", "serve"])
    ap.add_argument("--games", default=",".join(GAMES), help="komma-gescheiden lijst (standaard: alle)")
    ap.add_argument("--months", type=int, default=2, help="update: aantal maanden terug (standaard 2)")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args(argv)

    if args.command == "serve":
        serve(args.port)
        return 0
    if args.command == "rebuild":
        rebuild()
        return 0
    keys = [k.strip() for k in args.games.split(",") if k.strip()]
    for k in keys:
        get_game(k)
    added = 0
    for k in keys:
        added += update_game(k, full=args.command == "full", months_back=args.months)
    rebuild()
    _log(f"Klaar: {added} nieuwe trekking(en) in totaal.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

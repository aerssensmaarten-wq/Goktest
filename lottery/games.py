"""Definities van de kansspelen van de Nationale Loterij.

Elk spel beschrijft hoe een trekking eruitziet. Spelformules veranderden
doorheen de jaren (bv. Lotto 6/42 -> 6/45); die 'tijdperken' worden niet
hardgecodeerd maar uit de data afgeleid (zie storage.detect_eras).
"""
from __future__ import annotations

from dataclasses import dataclass, field

ZODIAC_SIGNS = (
    "Ram", "Stier", "Tweelingen", "Kreeft", "Leeuw", "Maagd",
    "Weegschaal", "Schorpioen", "Boogschutter", "Steenbok", "Waterman", "Vissen",
)


@dataclass(frozen=True)
class Game:
    key: str                 # bestandsnaam / id
    name: str                # weergavenaam
    kind: str                # "pool" (getallen uit een pot) of "digits" (cijfers 0-9 per positie)
    main_count: int          # aantal hoofdgetallen / cijfers per trekking
    main_max: int            # hoogste hoofdgetal (huidige formule) - voor digits: 9
    main_min: int = 1
    extra_count: int = 0     # bonus / sterren / Vikingnummer / Dream-nummer
    extra_max: int = 0
    extra_name: str = ""
    extra_from_main_pool: bool = False  # Lotto-bonusbal komt uit dezelfde pot
    has_sign: bool = False   # Joker+ sterrenbeeld
    pick_count: int = 0      # hoeveel getallen een speler kiest (Keno: 2-10)
    pick_min: int = 0
    pick_max: int = 0
    first_month: str = ""    # eerste maand met data bij de bron (YYYY-MM)
    source: str = ""
    source_path: str = ""
    draw_days: str = ""
    description: str = ""
    sanity_main_max: int = 0  # absolute bovengrens over alle tijdperken heen
    sanity_extra_max: int = 0
    # Spelformules doorheen de tijd: (vanaf-datum, hoogste hoofdgetal, hoogste extra getal)
    eras: tuple = field(default_factory=tuple)


GAMES: dict[str, Game] = {
    "lotto": Game(
        key="lotto", name="Lotto", kind="pool",
        main_count=6, main_max=45, extra_count=1, extra_max=45,
        extra_name="Bonusgetal", extra_from_main_pool=True,
        first_month="1978-02", source="lotteryextreme", source_path="/belgium/lotto-results",
        draw_days="woensdag en zaterdag",
        description="6 getallen uit 45 (tot 2011: uit 42) + bonusgetal.",
        sanity_main_max=45, sanity_extra_max=45,
        # 6/42 tot de formulewijziging in oktober 2011 (eerste getal > 42 op 2011-10-15).
        eras=(("1978-02-04", 42, 42), ("2011-10-01", 45, 45)),
    ),
    "euromillions": Game(
        key="euromillions", name="EuroMillions", kind="pool",
        main_count=5, main_max=50, extra_count=2, extra_max=12, extra_name="Sterren",
        first_month="2004-02", source="euromillionscom", source_path="/results-history-{year}",
        draw_days="dinsdag en vrijdag",
        description="5 getallen uit 50 + 2 sterren uit 12 (vroeger uit 9 en 11).",
        sanity_main_max=50, sanity_extra_max=12,
        eras=(("2004-02-13", 50, 9), ("2011-05-10", 50, 11), ("2016-09-24", 50, 12)),
    ),
    "eurodreams": Game(
        key="eurodreams", name="EuroDreams", kind="pool",
        main_count=6, main_max=40, extra_count=1, extra_max=5, extra_name="Dream-nummer",
        first_month="2023-11", source="lotteryextreme", source_path="/eurodreams/results",
        draw_days="maandag en donderdag",
        description="6 getallen uit 40 + 1 Dream-nummer uit 5.",
        sanity_main_max=40, sanity_extra_max=5,
        eras=(("2023-11-06", 40, 5),),
    ),
    "vikinglotto": Game(
        key="vikinglotto", name="Vikinglotto", kind="pool",
        main_count=6, main_max=48, extra_count=1, extra_max=5, extra_name="Vikingnummer",
        first_month="2017-05", source="lotteryextreme", source_path="/viking-lotto/results",
        draw_days="woensdag",
        description="6 getallen uit 48 + 1 Vikingnummer uit 5 (2017-2021: uit 8).",
        sanity_main_max=48, sanity_extra_max=8,
        # Vikingnummer uit 8, vanaf juni 2021 uit 5 (laatste nummer > 5 op 2021-06-02).
        eras=(("2017-05-24", 48, 8), ("2021-06-09", 48, 5)),
    ),
    "keno": Game(
        key="keno", name="Keno", kind="pool",
        main_count=20, main_max=70, pick_count=10, pick_min=2, pick_max=10,
        first_month="1995-05", source="lotteryextreme", source_path="/belgium/keno-results",
        draw_days="dagelijks",
        description="Er worden 20 getallen uit 70 getrokken (vroeger uit 80); je kiest er zelf 2 tot 10.",
        sanity_main_max=80,
        # 20 uit 80 tot maart 2008 (laatste getal > 70 op 2008-03-08).
        eras=(("1995-05-29", 80, 0), ("2008-03-10", 70, 0)),
    ),
    "jokerplus": Game(
        key="jokerplus", name="Joker+", kind="digits",
        main_count=6, main_max=9, main_min=0, has_sign=True,
        first_month="2011-01", source="lotteryextreme", source_path="/belgium/jokerplus-results",
        draw_days="dagelijks",
        description="6 cijfers (0-9) in volgorde + een sterrenbeeld.",
        sanity_main_max=9,
        eras=(("2011-02-02", 9, 0),),
    ),
    "pick3": Game(
        key="pick3", name="Pick3", kind="digits",
        main_count=3, main_max=9, main_min=0,
        first_month="2002-09", source="lotteryextreme", source_path="/belgium/pick3-results",
        draw_days="maandag t.e.m. zaterdag",
        description="3 cijfers (0-9) in volgorde.",
        sanity_main_max=9,
        eras=(("2002-09-02", 9, 0),),
    ),
}


def get_game(key: str) -> Game:
    try:
        return GAMES[key]
    except KeyError as exc:
        raise ValueError(f"Onbekend spel: {key!r}. Kies uit: {', '.join(GAMES)}") from exc

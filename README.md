# Goktest

Analyse van **alle trekkingen ooit** van de kansspelen van de Nationale Loterij:
Lotto, EuroMillions, EuroDreams, Vikinglotto, Keno, Joker+ en Pick3.

Per spel toont de app:

- de **meest** en **minst getrokken** getallen (en cijfers per positie bij Joker+/Pick3);
- de getallen die het **langst niet** meer getrokken werden (met gemiddeld interval);
- **patronen**: som van de getallen, even/oneven, laag/hoog, opeenvolgende getallen,
  herhalingen uit de vorige trekking, eindcijfers, vaakst samen getrokken paren en drietallen,
  sterrenbeelden (Joker+), aantal verschillende cijfers (Pick3/Joker+);
- een **chi-kwadraattoets** die aangeeft of de verschillen groter zijn dan toeval verklaart;
- de **winkans** op de hoofdprijs;
- een **generator** die één of meerdere voorstellen maakt (1–50), met vijf methodes:
  gebalanceerd (aanbevolen), warme getallen, achterstallige getallen, mix, puur toeval;
- bij elk voorstel of die combinatie **al eens gevallen** is (hoe vaak en wanneer laatst), en
  een **schakelaar** "Enkel combinaties die nog nooit gevallen zijn" (werkt bij alle methodes
  en spellen; bij Keno: getallen die nog nooit samen getrokken werden). Bij Pick3 zijn bijna
  alle 1.000 combinaties al eens gevallen; dan meldt de app dat er geen nieuwe mogelijk is;
- de volledige **uitslagenlijst** met zoekfunctie.

> **Eerlijk is eerlijk.** Bij een eerlijke trekking heeft elke combinatie exact dezelfde kans.
> De "gebalanceerde" methode kiest combinaties die passen bij de patronen die het vaakst
> voorkomen en vermijdt populaire keuzes (enkel verjaardagen ≤ 31, rijtjes, eerder getrokken
> combinaties). Dat verhoogt je winkans niet, maar wel je *verwachte uitbetaling*: win je,
> dan deel je de pot met minder mensen. Speel met mate.

## Starten

Enkel Python 3.10+ nodig (geen extra pakketten).

```bash
python3 -m lottery serve          # open daarna http://127.0.0.1:8000/web/
```

Uitslagen bijwerken:

```bash
python3 -m lottery update         # laatste 2 maanden ophalen + alles herberekenen
python3 -m lottery full           # volledige historiek (hervat waar gebleven)
python3 -m lottery rebuild        # JSON/SQLite opnieuw bouwen uit de CSV's (offline)
python3 -m lottery update --games lotto,euromillions
```

## Op je gsm als app

De app is een installeerbare web-app (PWA): met een eigen icoon op je beginscherm, schermvullend
zonder adresbalk, en ook bruikbaar zonder internet (de laatst opgehaalde uitslagen worden bewaard).

1. **Eenmalig: GitHub Pages aanzetten.** In de repository: *Settings → Pages → Build and deployment →
   Source: GitHub Actions*. Merge daarna naar `main`; de workflow publiceert de app op
   `https://<gebruikersnaam>.github.io/Goktest/web/` en werkt ze na elke trekking bij.
   GitHub Pages vanuit een **privé**-repository vereist een betaald GitHub-abonnement (Pro);
   anders moet de repository publiek worden. De gepubliceerde site is in beide gevallen publiek
   bereikbaar, maar bevat enkel de app en de (publieke) uitslagen: geen broncode, geen
   persoonsgegevens, geen sleutels.
2. **Installeren op je gsm.** Open de link:
   - *Android (Chrome):* menu ⋮ → **App installeren** / **Toevoegen aan startscherm**.
   - *iPhone (Safari):* deelknop → **Zet op beginscherm**.

## Databestanden

Alle uitslagen staan in de map [`data/`](data/):

| Bestand | Inhoud |
|---|---|
| `data/csv/<spel>.csv` | Eén rij per trekking – opent rechtstreeks in Excel, LibreOffice of Numbers |
| `data/loterij.sqlite` | Alle spellen in één SQLite-database (tabellen `spellen`, `trekkingen`, `getallen`, view `frequentie`). Wordt lokaal aangemaakt door `python3 -m lottery rebuild` of `update` (niet in git, want ~20 MB) |
| `data/json/<spel>.json` | Compact formaat voor de web-app |
| `data/json/index.json` | Overzicht: aantal trekkingen, eerste/laatste datum, spelformules |

Voorbeeld SQL (bv. met [DB Browser for SQLite](https://sqlitebrowser.org/)):

```sql
SELECT getal, aantal FROM frequentie
WHERE spel = 'lotto' AND soort = 'hoofd'
ORDER BY aantal DESC LIMIT 10;
```

## Automatisch bijwerken na elke trekking

De workflow [`.github/workflows/update.yml`](.github/workflows/update.yml) draait elke avond
na de trekkingen (en als vangnet elke ochtend). Ze haalt de nieuwe uitslagen op, draait de
tests, en commit de bijgewerkte CSV- en JSON-bestanden. De statistieken in de app worden
bij elk bezoek opnieuw uit die bestanden berekend, dus na elke trekking zijn ze automatisch
up-to-date. Je kunt de workflow ook handmatig starten via *Actions → Uitslagen bijwerken →
Run workflow*.

> GitHub voert geplande workflows enkel uit op de standaardbranch (`main`). Merge deze
> branch dus naar `main` om de automatische updates te activeren.

## Spelformules

De formules veranderden doorheen de jaren. De app analyseert standaard enkel de
**huidige formule**, maar je kunt ook alle trekkingen ooit of recente periodes kiezen
(de verwachte frequenties houden rekening met de formule die op elke datum gold).

| Spel | Data sinds | Formulewijzigingen |
|---|---|---|
| Lotto | 1978 | 6/42 → 6/45 (oktober 2011) |
| EuroMillions | 2004 | sterren uit 9 → 11 (mei 2011) → 12 (sept. 2016) |
| EuroDreams | 2023 | 6/40 + Dream-nummer 1/5 |
| Vikinglotto | 2017 | Vikingnummer uit 8 → uit 5 (juni 2021) |
| Keno | 1995 | 20 uit 80 → 20 uit 70 (maart 2008) |
| Joker+ | 2011 | 6 cijfers + sterrenbeeld |
| Pick3 | 2002 | 3 cijfers |

## Bronnen en beperkingen

De Nationale Loterij biedt geen publieke download van haar archief aan. De uitslagen komen
daarom uit publieke archiefwebsites: [lotteryextreme.com](https://www.lotteryextreme.com)
(Lotto, Keno, Pick3, Joker+, EuroDreams, Vikinglotto) en
[euro-millions.com](https://www.euro-millions.com) (EuroMillions). Er wordt beleefd gescraped
(maximaal 1 verzoek per seconde) en elke uitslag wordt gevalideerd (aantal getallen, bereik,
geen dubbels, geldig sterrenbeeld) voor ze wordt opgeslagen.

Bekende hiaten: in het Joker+-archief van de bron ontbreken 18 van de ruim 5.100 trekkingen.

## Ontwikkeling

```bash
python3 -m unittest discover -s tests -v   # scrapers, validatie, opslag, formules
node --test tests/*.test.mjs                       # statistiek en generator (Node 18+)
```

Structuur:

```
lottery/        Python: spellen, scrapers, opslag, CLI
web/            Web-app (HTML/CSS/JS, geen externe bibliotheken)
data/           Uitslagen (CSV, JSON, SQLite)
tests/          Tests
```

## Veiligheid

- Geen wachtwoorden, API-sleutels of persoonsgegevens nodig of opgeslagen.
- De web-app laadt geen externe scripts of lettertypes; een strikte Content-Security-Policy
  staat enkel eigen bestanden toe. Gegevens worden altijd als tekst (nooit als HTML) getoond.
- De lokale server luistert enkel op `127.0.0.1` en stuurt beveiligingsheaders mee.
- De scraper accepteert enkel HTTPS, begrenst de paginagrootte en valideert elke waarde.
- De GitHub-workflow heeft per taak enkel de rechten die ze nodig heeft (data committen,
  respectievelijk publiceren op Pages). Op Pages komen enkel `web/` en `data/csv|json`.
- De service worker verwerkt enkel eigen bestanden (zelfde domein, GET) en bewaart lokaal enkel
  uitslagen en app-bestanden; als voorkeur wordt enkel de stand van de schakelaar onthouden.

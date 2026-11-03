# Autobahn-API: verifizierte Erkenntnisse

Stand: **2026-11-03**. Alles hier stammt aus echten Requests gegen die Live-API
(Vollabzug: 113 Autobahnen × 6 Dienste = 678 Requests) und nicht aus der Doku.
Wo die Doku etwas anderes sagt, steht es dabei.

## Kurzfassung

| Frage | Antwort |
|---|---|
| Basis-URL | `https://verkehr.autobahn.de/o/autobahn` ✅ |
| CORS | **Ja.** `Access-Control-Allow-Origin: *` auf allen 678 Antworten, Preflight liefert `204`. Direkter Browser-Zugriff funktioniert, ein Proxy ist nicht nötig. |
| Anzahl Autobahnen | **113** (`GET /`) |
| Requests für einen Vollabzug | 1 (Liste) + 113 × Anzahl Dienste. Für 5 Layer also **566**. |
| Datenmenge Vollabzug | **≈ 9,9 MB** unkomprimiert. Davon sind 6,9 MB Baustellen-Geometrien. Der Server liefert **kein gzip**. |
| Dauer | 678 Requests mit 6 parallel: **9,4 s**, kein 429, kein Fehler |
| **Webcams** | ❌ **Leer auf allen 113 Autobahnen.** Siehe [Abschnitt Webcams](#webcams-seit-märz-2022-abgeschaltet). |
| tiles.autobahn.de | ❌ TLS-Zertifikat seit **2025-12-07** abgelaufen. Im Browser nicht nutzbar. |

## Endpunkte

Die OpenAPI-Spec liegt unter <https://autobahn.api.bund.dev/openapi.yaml>
(Version 1.0.1, Community-Projekt [bundesAPI/autobahn-api](https://github.com/bundesAPI/autobahn-api),
nicht von der Autobahn GmbH selbst). Sie ist in mehreren Punkten veraltet, siehe unten.

| Endpunkt | Status | Top-Level-Key | Einträge gesamt | Autobahnen ohne Daten |
|---|---|---|---|---|
| `GET /` | ✅ | `roads` | 113 | |
| `GET /{roadId}/services/roadworks` | ✅ | `roadworks` | 3047 | 9 / 113 |
| `GET /{roadId}/services/warning` | ✅ | `warning` | 88 | 82 / 113 |
| `GET /{roadId}/services/closure` | ✅ (*nicht in der ursprünglichen Liste*) | `closure` | 565 | 39 / 113 |
| `GET /{roadId}/services/electric_charging_station` | ✅ | `electric_charging_station` | 508 | 65 / 113 |
| `GET /{roadId}/services/parking_lorry` | ✅ | `parking_lorry` | 1825 | 36 / 113 |
| `GET /{roadId}/services/webcam` | ⚠️ antwortet, aber immer `{"webcam":[]}` | `webcam` | **0** | **113 / 113** |
| `GET /details/{dienst}/{id}` | ✅ für alle außer Webcam | Objekt | | |
| `GET /details/webcam/{id}` | ⚠️ `200` mit **leerem Body** | | | |

**Korrektur zur Annahme:** Die Detail-Endpunkte heißen `/details/{dienst}/{id}`
(z. B. `/details/roadworks/{id}`) und **nicht** `/{roadId}/services/webcam/{id}`. Die
ID muss URL-encodiert werden (sie enthält `.`, `-` und bei alten Einträgen `=`).
Die Details liefern dieselben Felder wie die Liste, plus ein paar optionale. Für v1
ist kein Detail-Request nötig.

Road-IDs sind nicht nur `A` plus Zahl: `A64a` und `A99a` kommen vor. Es gibt
Autobahnen, die nicht in der Liste stehen (z. B. A25), deren Meldungen aber unter
einer anderen Autobahn auftauchen (eine A25-Sperrung steckt in `A1/closure`).
Kein Identifier kommt doppelt vor, weder zwischen Autobahnen noch zwischen Diensten.

### Die API gibt nie 404 zurück

```text
GET /A9999/services/roadworks  →  200  {"roadworks":[]}
GET /A1/services/nope          →  200  {"nope":[]}
```

Unbekannte Autobahnen und **erfundene Dienstnamen** liefern `200` mit leerer Liste.
Der Top-Level-Key ist einfach der angefragte Dienstname. Ein leeres Ergebnis heißt
also nicht zwingend „gerade keine Meldungen“, es kann auch „diesen Dienst gibt es
nicht (mehr)“ bedeuten. Genau so sieht der Webcam-Dienst aus.

## HTTP-Verhalten

```text
HTTP/1.1 200 OK
Server: nginx/1.18.0 (Ubuntu)
Content-Type: application/json; charset=utf-8
X-Powered-By: Express
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: Content-Range
ETag: W/"64b3b-cGRvQZXAaDU7DdyFiq0a5XZvsJo"
```

- **CORS:** `*` auf jeder Antwort, auch auf Fehlerpfaden. `OPTIONS` liefert `204` mit
  `Access-Control-Allow-Methods: GET,HEAD,…` und `Max-Age: 3600`. Ein einfaches
  `fetch()` löst gar keinen Preflight aus.
  Achtung: `*` zusammen mit `Allow-Credentials: true` funktioniert nur **ohne**
  Credentials. Also nie `credentials: 'include'` setzen; der `fetch`-Default passt.
- **Keine Kompression:** Auch mit `Accept-Encoding: gzip, br` kommt die Antwort
  unkomprimiert (A7-Baustellen: 714 KB).
- **Kein `Cache-Control`**, nur ein schwaches `ETag`. Browser-Caching ist damit
  Heuristik-Sache, darauf verlassen wir uns nicht.
- **Kein Rate-Limit beobachtet:** 678 Requests, 6 parallel, alle `200`, langsamster
  Request 196 ms.
- **Encoding:** sauberes UTF-8 (Umlaute als `c3 bc`). Wer in einer Windows-Konsole
  `Saarbr�cken` sieht: Das liegt an der Konsole, nicht an der API.

## Datenstruktur

Alle Dienste liefern `{ "<dienst>": RoadItem[] }`. Die Felder sind gemeinsam, aber
einige sind je nach Dienst optional. Typen wie im Vollabzug beobachtet:

| Feld | Typ | Vorhanden | Bemerkung |
|---|---|---|---|
| `identifier` | string | immer | neu: Klartext (`2023-000357--vi-bs.…`, `30248`, `DE-NW-007341`); alt: Base64 (`RUxFQ1RS…==`) |
| `coordinate` | `{ lat, long }` | **immer** | **`long`, nicht `lon`!** Typ ist **number _oder_ string**, siehe unten |
| `point` | string | nicht bei Parkplätzen und neuen Ladesäulen | **Reihenfolge uneinheitlich**, nicht verwenden |
| `extent` | string | wie `point` | Bounding Box als String, Reihenfolge ebenso uneinheitlich |
| `geometry` | GeoJSON `LineString` | roadworks, warning, closure | Koordinaten `[lon, lat]` als Zahlen, GeoJSON-konform |
| `title` | string | immer | z. B. `"A1 \| Saarbrücken - Eppelborn"`, bei Parkplätzen manchmal `"A1 \| 0"` |
| `subtitle` | string | immer | Richtung bzw. Name, oft mit führendem Leerzeichen |
| `description` | string[] | immer | Freitext zeilenweise, inklusive leerer Zeilen als Absatz |
| `display_type` | string | immer | siehe Tabelle unten |
| `icon` | string | immer | Codes wie `"123"`, `"warnkegel"`, `"314-50"`, `"charging_plug_strong"` |
| `isBlocked` | **string** | immer | `"false"`/`"true"` als String, nicht als Boolean |
| `future` | boolean | immer | echter Boolean |
| `startTimestamp` | string | optional | **drei Formate**, siehe unten |
| `startLcPosition` | string | meist | Zahl als String |
| `impact` | `{ lower?, upper?, symbols: string[] }` | roadworks, closure (fast immer) | Fahrstreifen-Symbole wie `CLOSED`, `ARROW_UP` |
| `routeRecommendation`, `footer` | array | immer | meist leer; `footer` bei Parkplätzen z. B. `"Koordinaten: … lng, … lat"` |
| `lorryParkingFeatureIcons` | `{ icon, description, style }[]` | immer | nur bei Parkplätzen gefüllt (Toilette, Mülleimer, …) |
| `delayTimeValue`, `averageSpeed` | **string** | nur warning, optional | Minuten bzw. km/h als String |
| `abnormalTrafficType` | string | nur warning, optional | `QUEUING_TRAFFIC`, `SLOW_TRAFFIC`, `HEAVY_TRAFFIC`, `UNSPECIFIED_ABNORMAL_TRAFFIC` |
| `source` | string | warning, selten closure | `inrix`, `eva`, `manuell` |

### `display_type` je Dienst

| Dienst | Werte (Anzahl) |
|---|---|
| roadworks | `ROADWORKS` (1759), `SHORT_TERM_ROADWORKS` (1288) |
| warning | `WARNING` (87), **`CLOSURE` (1)**: auch im Warning-Dienst können Sperrungen stehen |
| closure | `CLOSURE_ENTRY_EXIT` (472), `CLOSURE` (89), `CLOSURE_LOAD_VZ_3_5` (2), `CLOSURE_LOAD_VZ_16` (2) |
| electric_charging_station | `STRONG_ELECTRIC_CHARGING_STATION` (489), `ELECTRIC_CHARGING_STATION` (19) |
| parking_lorry | `PARKING` (1825) |

### Koordinaten: die drei Fallen

1. **`lat`/`long` sind mal Zahl, mal String, innerhalb desselben Dienstes.** Bei
   den Ladesäulen haben 447 Einträge Strings (`"52.434341"`) und 61 Zahlen. Bei
   allen anderen Diensten waren es im Abzug Zahlen. Der Parser muss beides können:
   `Number(x)`, danach `Number.isFinite` prüfen.
2. **Das Feld heißt `long`**, nicht `lon` oder `lng`.
3. **`point`/`extent` haben keine feste Reihenfolge.** 3700 Einträge haben
   `"lat,lon"`, 447 Einträge (die alten Ladesäulen mit Base64-ID) `"lon,lat"`. Die
   Spec dokumentiert nur `"lon,lat"`. Wir verwenden deshalb ausschließlich `coordinate`.

Plausibilitätsprüfung im Abzug: alle 5833 Einträge liegen in der Box
47–55,5 °N / 5,5–15,5 °O. Keine 0,0-Koordinaten und keine unparsbaren Werte. Der
Code muss trotzdem defensiv sein: Einträge ohne gültige Koordinate werden
übersprungen und nicht bei 0,0 platziert.

### Zeitstempel

| Dienst | Format | Beispiel |
|---|---|---|
| roadworks, closure | ISO 8601 mit Offset | `2026-08-10T11:00:00+02:00` |
| warning | ISO 8601 UTC (84) bzw. mit Offset (4) | `2026-11-03T12:16:00Z` |
| electric_charging_station | **deutsches Datum** | `30.03.2026` |

## Webcams: seit März 2022 abgeschaltet

- **Live-Befund:** `services/webcam` liefert auf **allen 113 Autobahnen**
  `{"webcam":[]}`. `details/webcam/{id}` liefert mit der Beispiel-ID aus der Spec
  `200` und einen leeren Body. Die Bild-URL aus dem Spec-Beispiel
  (`www.verkehr.nrw/webcams/….jpg`) antwortet mit `403`.
- **Hintergrund:** Die Autobahn GmbH hat die Webcam-Bilder im **März 2022** aus
  Sicherheitsgründen im Zusammenhang mit dem Ukraine-Krieg vom Netz genommen. Die
  Kameras laufen weiter, nur die Bilder werden nicht mehr öffentlich ausgeliefert
  ([PC-Welt mit Stellungnahme der Autobahn GmbH](https://www.pcwelt.de/article/1202790/sicherheitsgruende-keine-bilder-mehr-von-deutschen-autobahn-webcams.html),
  [Der Standard](https://www.derstandard.at/story/2000134061892/deutsche-autobahn-webcams-wegen-ukraine-krieg-offline)).
  Eine Bundestags-Petition zur Wiederherstellung wurde abgelehnt
  ([Petition 137678, Abschlussbegründung](https://epetitionen.bundestag.de/petitionen/_2022/_08/_12/Petition_137678.abschlussbegruendungpdf.pdf)).
  Hinweise auf eine Reaktivierung haben wir keine gefunden.
- **Schema laut Spec**, falls der Dienst zurückkommt: die üblichen Felder plus
  `operator`, `imageurl`, `linkurl`. Das Spec-Beispiel hat `coordinate.lat`/`long`
  als String.

## Kartenhintergrund

| Option | Ergebnis |
|---|---|
| `tiles.autobahn.de/osm_tiles/{z}/{x}/{y}.png` | ❌ Zertifikat (Telekom Security, `CN=tiles.autobahn.de`) gültig 2024-12-03 bis **2025-12-07**, seitdem abgelaufen. Browser blockieren das, und für ein öffentliches Projekt ist es keine Grundlage. |
| OpenFreeMap `https://tiles.openfreemap.org/styles/positron` | ✅ Vektor-Style, 25 KB, CORS `*`, kein API-Key, weltweit. Attribution kommt automatisch aus dem TileJSON: „OpenFreeMap © OpenMapTiles Data from OpenStreetMap“. |
| basemap.de (BKG) `…/gdz_basemapde_vektor/styles/bm_web_gry.json` | ✅ CORS ok, kein Key, aber 500 KB Style mit 572 Layern und außerhalb Deutschlands leer. Attribution: „© basemap.de / BKG \| Datenquellen: © GeoBasis-DE“. |

**Gewählt: OpenFreeMap Positron.** Der Style ist leicht, hell und ruhig, sodass
die Daten-Marker gut hervortreten. Ein Key ist nicht nötig, und die Nachbarländer
sind nicht leer.

## Lizenz und Attribution

- Die API unter `verkehr.autobahn.de/o/autobahn` ist das Backend der Autobahn App und
  der Webkarte. Eine **ausdrückliche Lizenz für die API selbst haben wir nicht
  gefunden**: `autobahn.de/impressum` enthält keine, `/nutzungsbedingungen` und
  `/open-data` liefern 404, und die OpenAPI-Spec nennt keine Lizenz.
- Der nächste offizielle Anhaltspunkt: Die Autobahn GmbH führt den Datensatz
  **„Die Autobahn App“** auf Mobilithek/GovData (Herausgeber: *Die Autobahn GmbH des
  Bundes*, Mobilithek-Angebot `573189053963235328`) mit der Lizenz-URI
  `http://dcat-ap.de/def/licenses/geonutz/20130319`, also der
  **[GeoNutzV](https://www.gesetze-im-internet.de/geonutzv/BJNR054700013.html)**
  (Verordnung zur Festlegung der Nutzungsbestimmungen für die Bereitstellung von
  Geodaten des Bundes). Abgefragt über die GovData-CKAN-API.
- **GeoNutzV kurz:** §2 erlaubt kommerzielle und nicht kommerzielle Nutzung ohne
  Kosten, inklusive Verändern und Verknüpfen mit anderen Daten. §3 verlangt einen
  **Quellenvermerk**, der „erkennbar und in optischem Zusammenhang“ eingebunden
  wird, und bei Veränderungen einen **Veränderungshinweis**.
- **Konsequenz für uns:** Quellenvermerk direkt auf der Karte (MapLibre-Attribution),
  etwa „Daten: © Die Autobahn GmbH des Bundes, verkehr.autobahn.de (aufbereitet)“.
  „Aufbereitet“ ist der Veränderungshinweis, denn wir filtern und stellen die Daten
  anders dar. Im README stellen wir die Lizenzlage ehrlich als *abgeleitet* dar und
  nicht als ausdrücklich erteilte Open-Data-Lizenz.

## Konsequenzen für die Umsetzung

- Kein Proxy, kein Backend, kein Key: Der Browser ruft die API direkt auf.
- Loader mit begrenzter Parallelität (6 gleichzeitig hat sich bewährt) und mit
  Status pro Autobahn und Dienst, damit leere und kaputte Antworten in der UI
  sichtbar sind.
- ~10 MB ohne gzip sind für Mobilgeräte viel. Layer laden wir deshalb erst, wenn
  sie eingeschaltet werden; ein Layer ist dann ein Durchlauf über alle 113
  Autobahnen.
- Koordinaten-Parser: `coordinate.lat`/`long` → `Number()` → `isFinite` und
  Plausibilitäts-Box. Ungültige Einträge werden gezählt und übersprungen.
- Typen: `isBlocked`, `delayTimeValue`, `averageSpeed` sind Strings;
  `coordinate.lat`/`long` sind `number | string`; viele Felder sind optional.
- Ein leerer Webcam-Dienst ist der Normalzustand und wird ehrlich angezeigt.

## Methode

Abgefragt mit `curl` und einem Python-Skript (`urllib`, ThreadPool mit 6 Workern,
`Origin`-Header gesetzt). Ausgewertet wurden HTTP-Status, CORS-Header,
Content-Type, Größe, Top-Level-Keys, Feldtypen je Eintrag, Koordinaten-Typen und
-Plausibilität, `point`-Reihenfolge gegen `coordinate`, Zeitstempel-Formate und
doppelte IDs zwischen Autobahnen und Diensten.

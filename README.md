# Autobahn Live Map

<!-- Screenshot oder GIF: docs/screenshot.png (wird nachgeliefert) -->
![Autobahn Live Map: Baustellen, Staus und Sperrungen auf einer Deutschlandkarte](docs/screenshot.png)

**Alle offenen Verkehrsdaten der Autobahn GmbH auf einer Karte: Baustellen, Staus, Sperrungen, Ladesäulen und Lkw-Parkplätze, live aus der API, ohne Backend und ohne API-Key.** Die Daten sind seit Jahren frei abrufbar, aber verteilt auf 113 Autobahnen und fünf Dienste; dieses Projekt holt sie zusammen und rechnet ein wenig damit.

**Live:** [maikcoding.github.io/autobahn-live-map](https://maikcoding.github.io/autobahn-live-map/) · Beispiel: [nur die A7](https://maikcoding.github.io/autobahn-live-map/?road=A7)

## Was die Karte kann

- **Fünf Ebenen**, einzeln schaltbar: Verkehrsmeldungen, Sperrungen, Baustellen, Ladesäulen, Lkw-Parkplätze. In der Übersicht als Cluster, ab Zoomstufe 9 mit den tatsächlichen Baustellen- und Stauabschnitten als Linien.
- **Details per Klick:** der Meldungstext der Autobahn GmbH, bei Staus Zeitverlust und Durchschnittstempo, bei Parkplätzen die Ausstattung.
- **Autobahnen anklicken:** Das Netz ist hervorgehoben. Ein Klick markiert die ganze Autobahn und zeigt ihre Zahlen.
- **Statistik:** Bundesländer nach Sperrungen, Baustellen oder Staus, die Autobahnen mit den meisten Baustellen-Kilometern und Rekorde wie der größte Zeitverlust gerade.
- **Filter nach Autobahn** (`A3`, auch `A3, A5`). Filter und Ebenen stehen in der URL, Ansichten lassen sich teilen: `?road=A7&layers=warning,closure`.
- **Ehrlich bei Fehlern:** Nicht erreichbare Autobahnen werden genannt, Einträge ohne brauchbare Koordinate gezählt und ausgelassen. Ersatzdaten gibt es nicht.
- **Auf dem Handy** mit einklappbarer Ebenenliste und Detailansicht von unten.

## Lokal starten

```bash
git clone https://github.com/MaikCoding/autobahn-live-map.git
cd autobahn-live-map
npm install && npm run dev
```

## Wie es funktioniert

Reines Frontend mit Vite, TypeScript ohne UI-Framework und [MapLibre GL JS](https://maplibre.org/) als einziger Laufzeit-Abhängigkeit. Der Browser fragt die API direkt ab:

```text
GET /o/autobahn/                          → Liste der Autobahnen (113)
GET /o/autobahn/{A1…}/services/{dienst}   → je Ebene einmal pro Autobahn,
                                            höchstens 6 Anfragen gleichzeitig
    → prüfen und normalisieren → GeoJSON → MapLibre-Cluster
```

Die API ist nur inoffiziell dokumentiert. Vor dem ersten Code habe ich sie mit einem Vollabzug geprüft; die Ergebnisse stehen in [`docs/api-notes.md`](docs/api-notes.md). Das Wichtigste:

- **CORS ist offen** (`Access-Control-Allow-Origin: *`), deshalb braucht es weder Proxy noch Backend.
- **Die API antwortet nie mit 404.** Unbekannte Autobahnen und sogar erfundene Dienste liefern `200` mit leerer Liste. Leer heißt also nicht zwingend „keine Meldungen“.
- **Koordinaten sind uneinheitlich:** `coordinate.lat`/`long` kommen mal als Zahl, mal als String, und `point` hat je nach Datensatz die Reihenfolge lat,lon oder lon,lat. Der Code liest nur `coordinate`, prüft auf eine Box um Deutschland und überspringt den Rest; nichts landet bei 0,0.
- **Kein gzip, rund 10 MB für alles.** Ebenen laden erst beim Einschalten, und alle Ebenen teilen sich eine Warteschlange mit 6 parallelen Anfragen.
- **Webcams gibt es nicht mehr.** Der Dienst ist auf allen Autobahnen leer, seit die Autobahn GmbH die Bilder im März 2022 aus Sicherheitsgründen abgeschaltet hat.
- **`tiles.autobahn.de`** hat seit Dezember 2025 ein abgelaufenes Zertifikat; der Kartenhintergrund kommt deshalb von [OpenFreeMap](https://openfreemap.org/).

Und die Statistik:

- **Bundesland** per Punkt-in-Polygon gegen die Ländergrenzen des BKG (VG2500). Die Grenzen sind generalisiert; an Landesgrenzen kann ein Eintrag im Nachbarland landen.
- **Baustellen-Kilometer** aus der Liniengeometrie der Meldungen. Sie weicht im Median um 0,3 % von der „Länge“ im Meldungstext ab. Beide Fahrtrichtungen und überlappende Bauphasen zählen einmal; einfaches Aufsummieren hätte die A7 auf ihre volle Länge gebracht.
- **Das Autobahnnetz** stammt aus den Vektorkacheln von OpenFreeMap, also aus OpenStreetMap. Autobahnnummern tragen sie erst ab Zoomstufe 6; darunter ist das Netz sichtbar, aber nicht anklickbar.

```text
src/
  api/      Typen nach echten Antworten, Client, Laufzeitprüfungen
  data/     Normalisierung, Loader, Geo- und Statistikfunktionen, Ländergrenzen
  layers/   die fünf Ebenen: Farbe, Symbol, Varianten
  map/      Karte, Datenebenen, Autobahnnetz
  ui/       Ebenenliste, Filter, Detail- und Statistik-Panel
scripts/    build-geodata.mjs erzeugt die Ländergrenzen neu (npm run build:geodata)
docs/       api-notes.md: was die API wirklich liefert
```

## Datenquellen und Lizenzen

| Daten | Quelle | Bedingungen |
| --- | --- | --- |
| Verkehrsdaten | [Die Autobahn GmbH des Bundes](https://www.autobahn.de/), `verkehr.autobahn.de` | siehe unten |
| Ländergrenzen | © [BKG](https://gdz.bkg.bund.de/) (2026), Verwaltungsgebiete 1:2 500 000 | [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0), [Datenquellen](https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf) |
| Kartenhintergrund, Autobahnverlauf | [OpenFreeMap](https://openfreemap.org/), © [OpenMapTiles](https://www.openmaptiles.org/), Daten © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende | [ODbL](https://opendatacommons.org/licenses/odbl/) |

**Zur Lizenz der Verkehrsdaten:** Die Schnittstelle ist das Backend der Autobahn App; die [OpenAPI-Beschreibung](https://autobahn.api.bund.dev/) stammt vom Community-Projekt [bundesAPI](https://github.com/bundesAPI/autobahn-api). Eine ausdrückliche Lizenz für die API selbst ist nicht veröffentlicht. Der nächste offizielle Anhaltspunkt ist der Datensatz „Die Autobahn App“, den die Autobahn GmbH auf Mobilithek und GovData unter der [GeoNutzV](https://www.gesetze-im-internet.de/geonutzv/BJNR054700013.html) führt: Nutzung frei, auch kommerziell, mit Quellenvermerk in optischem Zusammenhang und einem Hinweis auf Veränderungen (§ 3). Die Karte zeigt deshalb dauerhaft „Verkehrsdaten © Die Autobahn GmbH des Bundes, aufbereitet“. Wer die Daten anders nutzen möchte, fragt am besten bei der Autobahn GmbH nach.

Dies ist ein privates Projekt ohne Verbindung zur Autobahn GmbH. Keine Gewähr für Vollständigkeit oder Aktualität; unterwegs gilt die Beschilderung.

## Platz für später

Eine **Historie** ist nicht eingebaut, hat aber einen klaren Andockpunkt: `loadService()` liefert pro Ebene einen vollständigen Schnappschuss mit Zeitstempel (`ServiceData`). Ein Job, der diese Schnappschüsse regelmäßig ablegt, und eine Zeitleiste, die sie wieder in `setItems()` gibt, reichen dafür.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) baut bei jedem Push auf `main` und veröffentlicht `dist/` auf GitHub Pages. Einmalig in den Repository-Einstellungen unter *Pages* die Quelle „GitHub Actions“ wählen. Dank `base: './'` läuft der Build unter jedem Unterpfad.

## Lizenz

Der Code steht unter der [MIT-Lizenz](LICENSE). Für die Daten gelten die Bedingungen oben.

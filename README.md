# 🗺️ Trips

A tiny, self-hostable **trip map dashboard**. Pick a trip, get a map of your pins — pintxos bars, coffee stops, day trips — grouped by category and synced across your phone and laptop.

🌍 Live: **https://trips.kieranajp.uk**

## ✨ What it does

- 📍 Drop, edit and categorise pins on a map
- ☕🍷🍽️ Colour-coded categories with one-tap **show-only-this** filtering
- 💡 An **Ideas** tab of curated picks you can add with a tap
- 🔀 Syncs across devices (localStorage + server), and works offline
- 📥 Imports Google Takeout saved-place CSVs

## 🧱 Stack

One Go binary. No Node, no bundler, no build step. 🎈

- **Backend** — Go `net/http` + SQLite (`modernc.org/sqlite`), with the whole frontend embedded via `go:embed`
- **Frontend** — Preact + htm + signals over an importmap (straight from a CDN), Leaflet for the map
- **Deploy** — Docker → GHCR → Helm on a k8s homelab, all via GitHub Actions

## 🏃 Run it locally

```sh
DB_PATH=./trip.db PORT=8090 go run .
```

Then open **http://localhost:8090** 🎉

> The container defaults `DB_PATH` to `/data/trip.db`; set it somewhere writable when running locally.

## 🧳 Add a trip

No code required:

1. Drop a `web/trips/<id>.json` (copy the shape of `bilbao.json`).
2. Add a line to `web/trips/index.json`.

It'll appear on the picker. ✅

## 🚀 Deploy

Push to `main`. CI tests, builds an image, pushes it to GHCR, and Helm-upgrades the cluster. Grab a ☕ while it rolls out.

---

🤖 Working on this with an AI agent? See [AGENTS.md](AGENTS.md).

## Area files

Open **Setup → Areas → Export areas** to download `<trip-id>-areas.json`, including
an empty template for trips without seeds. Edit the JSON, then sign in and choose
**Import area file**. Review the added, changed and removed IDs before Apply;
Cancel leaves the trip unchanged. Imports replace the whole area set. Omitted
IDs are removed and `"areas": []` clears it, including after reload. **Restore
seeded areas** previews a return to the current trip definition. Reset everything
also removes custom areas. Pin import/export does not change areas.

```json
{
  "type": "trips-areas",
  "version": 1,
  "tripId": "oviedo",
  "areas": [{
    "id": "example",
    "name": "Example travel area",
    "note": "An indicative outline for a walk.",
    "color": "#c26b3d",
    "approximate": true,
    "ring": [[43.36, -5.85], [43.36, -5.84], [43.35, -5.84]]
  }]
}
```

Coordinates are `[latitude, longitude]`. This format accepts one simple ring per
area, not GeoJSON. Rings need 3–500 distinct vertices; an optional repeated closing
vertex is removed. Self-intersections, zero-area rings, duplicate vertices,
antimeridian crossings and coordinates outside ±85.05112878 latitude or ±180
longitude are rejected. Overlap between different areas is allowed.

Files are limited to 256 KiB UTF-8 and 100 areas. The complete trip state must fit
the server's 1 MiB limit. All shown fields are required; unknown fields are
rejected. IDs contain 1–64 lowercase letters, digits or hyphens. Names are
nonblank, at most 120 characters; notes are plain text, at most 4,000 characters.
Colours use six hexadecimal digits. `approximate` is boolean; true adds an
approximation notice, while false makes no official-boundary claim. Optional
`label` (nonblank, at most 120 characters), `labelAt` (coordinate inside the
polygon) and `labelMinZoom` (integer 0–19) are retained in files.

Areas may also include an optional `ratings` object, for example
`"ratings": {"touristiness": 2, "foodDrink": 5, "ourKindOfPlace": 4}`.
These are subjective travel ratings: 📷 Touristiness (higher means more touristy),
🍷 Food & drink interest, and ❤️ Our kind of place. Each supplied score must be
an integer from 1 to 5. Individual scores may be omitted; missing scores are not
inferred or displayed. Empty ratings are allowed; unknown rating fields are rejected.
Cards and the explorer show the same labels and numeric scores. Ratings survive
export, edits and import for any trip; older files without ratings remain valid.

Apply first saves on this device, then syncs to the server. Pending and failed
writes stay local across reload; **Retry sync** sends them again. Sign in if the
server rejects an unauthorised write. Focus updates cannot overwrite a pending
local save. Once synced, the next successful pull adopts the server's snapshot.
Sync is **last successful write wins for the whole trip**: concurrent devices
can overwrite each other's edits, including pins and areas. There is no merge or
revision check. Older clients that omit areas restore seed semantics when their
write wins. Invalid remote areas are rejected without overwriting that snapshot.


### Reading areas

Hover over an outline to read its full name and note without moving the map.
Move into the card to keep it open. Click or tap to select it; hovering other
areas leaves the selection in place. Escape dismisses the card until the pointer
leaves and re-enters. Pin and stay cards take precedence over area hover.

Use **Explore areas** to read the same full notes with a keyboard or touch. Each
area has its own disclosure and **Show on map** button. That button enables areas,
fits the outline and opens its card while keeping keyboard focus on the button.
The explorer stays readable when the map's Areas toggle is off.

Optional `label`, `labelAt` and `labelMinZoom` control short map labels, their
anchor inside the polygon, and their first visible zoom level. Cards and the
explorer always retain the full area name and note.

The basemap uses CARTO Voyager when `CARTO_API_KEY` is configured. Otherwise it
uses standard OpenStreetMap tiles with attribution and browser caching, under
the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).

### Gijón travel areas

Gijón ships eight independently authored travel zones: La Arena, Cimavilla,
Centro / El Carmen, Marina / El Muelle, Fomento, El Llano,
Poniente / Natahoyo / west, and Somió / east. Their notes include the trip's
personal fit preferences. Colours distinguish zones rather than scores.

These are approximate travel areas with indicative edges and deliberate gaps,
not official neighbourhood boundaries or claims about which venues belong to
which district. Marina, Fomento and Centro remain separately selectable. Use
Setup's area export/import to customize them, or restore the seeded outlines.


### Bilbao and Oviedo travel areas

Bilbao has six practical zones: Indautxu / Ensanche, Bilbao la Vieja (“Bilbi”),
Deusto, Casco Viejo, Pozas / San Mamés, and Guggenheim / Abandoibarra. Oviedo
has six: Ruta de los Vinos, the western Ensanche, Uría / Campoamor, Gascona /
Foncalada, the Cathedral / old town, and Fontán / Trascorrales.

Their concise notes favour local bars, coffee, wine/vermouth and worthwhile
food stops. The three scores express editorial travel preferences; touristiness
measures visitor focus, not food quality. Outlines are independently authored
travel envelopes with deliberate gaps, not official district boundaries or venue
membership rules. They use the same files and explorer as Gijón.

New seeds appear when `areaOverride` is missing or null. Existing custom areas
(including an empty set) stay unchanged. To adopt these seeds, export any custom
areas you want to keep, then use **Setup → Areas → Restore seeded areas** and
review the replacement. Pins, categories, flights and stays are preserved.

Geographic context comes from the official [Bilbao pintxos routes](https://www.bilbaoturismo.net/BilbaoTurismo/es/rutas),
[Bilbao la Vieja guide](https://www.bilbao.eus/servlet/Satellite/BilbaoTurismo/es/espacio-bilbao-la-vieja/bilbao-la-vieja),
[Oviedo visitor guide](https://www.turismoasturias.es/documents/39908/11979417/Guia-visitar-Oviedo-ES.pdf)
and [Asturias cities guide](https://www.turismoasturias.es/documents/39908/2503855/Ciudades_ES.pdf/fbf136c7-c577-bb84-efb2-dd7ece45a436).
Coffee/gourmet detours also use the trip's existing venue pins. Sources inform
area character; the outlines and scores are our own travel judgments.

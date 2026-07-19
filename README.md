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

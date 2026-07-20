# AGENTS.md

Notes for AI agents. The code is small — read it. This file is the stuff the code *won't* tell you: footguns and non-obvious wiring.

## The big one: the frontend is embedded in the binary

`main.go` does `//go:embed all:web`. Editing anything under `web/` has **zero effect** until you **rebuild the Go binary and restart**. There is no dev server and no hot reload. The loop is always: edit `web/*` → `go build` → restart the process.

## Naming: "trips" (the app) vs "bilbao" (a trip)

The app/repo is `trips`. `bilbao` is one *trip id*. `web/trips/bilbao.json`, the `bilbao` entry in `index.json`, and `bilbao` DB/localStorage keys are **data**, not a leftover of an old app name — do not "rename bilbao → trips" there. Only app-level identifiers (Go module, binary, chart, image) were renamed.

## Two kinds of "data" — never conflate them

- **Trip definitions** — static JSON in `web/trips/*.json`, committed. The *seed*: catalogue, categories, neighbourhoods, and the starting flights/stays.
- **User state** — pins, categories, flights and stays, per trip, in SQLite (`/state?trip=<id>`) and localStorage (`trip_state_<id>`). **Not in the repo.**

There is no separate "base" marker any more: the map's home pin(s) render from whichever **stays** carry `lat`/`lng`. A stay and its map marker are one and the same.

Editing `bilbao.json` changes the seed for a *fresh* trip. It does **not** touch a user whose state has already diverged (they load from their saved state, not the seed).

## SQLite is single-writer

The Helm Deployment is `strategy: Recreate`, `replicaCount: 1`, on a ReadWriteOnce PVC. **Never set replicas > 1** — two pods on one SQLite file will corrupt/split state. Sync is deliberately naive last-write-wins (debounced PUT, pull on boot + window focus).

## The frontend has no build step

Preact + htm + `@preact/signals`, loaded via `<script type="importmap">` from esm.sh. Consequences:

- **No JSX.** It's `html\`...\`` tagged templates (htm).
- The `?external=preact` on the signals/htm CDN URLs is **load-bearing** — it forces a single shared Preact instance. Remove it and you get two Preact copies and hooks break.
- **Leaflet is imperative and lives outside the Preact tree**, driven by signal `effect()`s in `web/features/map/leaflet.js`. `#map` is a `ref`'d escape hatch Preact never renders into. Don't try to render markers through components.

## Trip switching is a full page load

Choosing a trip navigates to `?trip=<id>` (a real reload), on purpose — it sidesteps Leaflet teardown. There is no in-app trip swap. `?trip` must match `^[a-z0-9-]+$` or the server 400s (the frontend enforces the same slug).

## Secrets & personal data are gitignored — the repo is PUBLIC

`.env` (Google Places API key), `Takeout/`, `*.csv`, and `bilbao-import.json` are gitignored. **Never commit them.** Before any `git add -A`, confirm none are staged (`git ls-files --cached | grep -iE '\.env|Takeout|\.csv|import\.json'` should be empty).

## cmd/import & cmd/seedurls are one-off local tools

They are **not** part of the running app. They read the gitignored Bilbao CSV, call Google Places (needs `GOOGLE_PLACES_API_KEY` in `.env`), and emit JSON you load through the app's Import button. Don't wire them into the server.

## Deploy is automatic on push to `main`

`.github/workflows/`: **CI** builds/pushes an **amd64** image tagged `sha-<short>` + `latest` to GHCR; **Deploy** (on CI success) joins Tailscale and runs `helm upgrade --install trips`. Because the image tag is `:latest` + `Recreate`, the deploy pins the exact `sha-` tag via `--set app.image.tag` — pushing `:latest` alone would **not** re-pull. Helm is pinned to **v3** (v4's `--wait` false-times-out on a ClusterIP Service).

Any push to `main` (docs included) triggers a full build + deploy.

## Auth is enforced at the ingress by method+path, not in Go

There is **no auth code in `main.go`** — the handlers trust that whatever reaches them already cleared Authentik. Access is decided in `charts/trips/templates/ingressroute.yaml` (Traefik `IngressRoute`), by Traefik rule **priority**:

- **All GET/HEAD/OPTIONS are public** (the priority-80 rule). So a new read endpoint returning private data is **public by default** — it silently falls through to that rule. Guard it with a higher-priority `PathPrefix(...)` rule carrying the `auth-private` middleware (see the `/files` rule, priority 85).
- **All other verbs are default-closed** (the lowest-priority catch-all has `auth-private`). A new write verb is gated automatically — good — but a new *read* is not.

The Go layer reads identity only from `X-authentik-*` headers the outpost injects (`/whoami`). Frontend `editable`/`canEdit` gating is **cosmetic** — the ingress is the actual trust boundary. Never rely on the SPA hiding a control to protect data.

## readOnlyRootFilesystem in prod

In-cluster the container can only write to `/data` (the PVC). Code that writes elsewhere works locally but fails in prod. Keep SQLite (and its temp/WAL files) under `DB_PATH`, which lives in `/data`.

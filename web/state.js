// Signals + per-trip persistence + every mutation. Trip definitions are static
// JSON under /trips; user state (pins, categories) is per-trip in the server DB.
import { signal } from "@preact/signals";

// ---- signals ----
export const trips = signal([]);     // picker index (from /trips/index.json)
export const trip = signal(null);    // active trip definition, null = show picker
export const cats = signal([]);
export const pins = signal([]);
export const hidden = signal(new Set()); // hidden category ids (view-only, not persisted)
export const tab = signal("map");        // map | ideas | setup
export const areasOn = signal(true);
export const placing = signal(false);    // "click the map to drop a pin" mode
export const editing = signal(null);     // { pin } to edit, { latlng } for new, null = closed
export const toastMsg = signal("");

export const catById = (id) => cats.value.find((c) => c.id === id) || cats.value[cats.value.length - 1];
export const onMap = (cid) => pins.value.some((p) => p.src === cid);

// ---- trip loading ----
const validId = (id) => /^[a-z0-9-]+$/.test(id || "");
async function loadTrips() {
  try { const r = await fetch("/trips/index.json"); if (r.ok) trips.value = await r.json(); } catch (e) {}
}
async function loadTrip(id) {
  if (!validId(id)) return null;
  try { const r = await fetch(`/trips/${id}.json`); if (r.ok) return await r.json(); } catch (e) {}
  return null;
}

export async function boot() {
  const id = new URLSearchParams(location.search).get("trip");
  if (!id) return loadTrips();          // no trip → picker
  const def = await loadTrip(id);
  if (!def) { location.search = ""; return; } // bad id → back to picker
  trip.value = def;
  document.title = `${def.title} — ${def.subtitle}`;
  const s = localLoad(id) || freshState(def);
  cats.value = s.categories;
  pins.value = s.pins;
}

// ---- persistence (keyed by trip id) ----
const lsKey = (id) => "trip_state_" + id;
function freshState(def) {
  const p = def.catalog.filter((c) => def.seedOnMap.includes(c.cid))
    .map((c) => ({ id: "p_" + c.cid, name: c.name, lat: c.lat, lng: c.lng, cat: c.cat, note: c.note, url: c.url, src: c.cid }));
  return { categories: def.categories.map((c) => ({ ...c })), pins: p };
}
function localLoad(id) { try { const r = localStorage.getItem(lsKey(id)); return r ? JSON.parse(r) : null; } catch (e) { return null; } }

// localStorage is the instant local cache; the server (/state?trip=, SQLite blob)
// is the cross-device source of truth. Debounced PUT on change, GET on boot + focus.
// ponytail: last-write-wins — you + Del won't edit the same second.
let lastSynced = "", putTimer;
function save() {
  const id = trip.value.id;
  const body = JSON.stringify({ categories: cats.value, pins: pins.value });
  try { localStorage.setItem(lsKey(id), body); } catch (e) {}
  clearTimeout(putTimer);
  putTimer = setTimeout(() => pushState(body), 800);
}
async function pushState(body) {
  body = body || JSON.stringify({ categories: cats.value, pins: pins.value });
  if (body === lastSynced) return;
  try {
    const res = await fetch(`/state?trip=${trip.value.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) lastSynced = body;
  }
  catch (e) { /* offline — localStorage holds it, retries next change */ }
}
export async function pullState() {
  if (!trip.value) return false;
  try {
    const res = await fetch(`/state?trip=${trip.value.id}`); if (!res.ok) return false;
    const txt = await res.text();
    if (!txt || txt === "{}" || txt === lastSynced) return false;
    const d = JSON.parse(txt);
    if (!Array.isArray(d.pins) || !Array.isArray(d.categories)) return false;
    lastSynced = txt;
    cats.value = d.categories; pins.value = d.pins;
    try { localStorage.setItem(lsKey(trip.value.id), txt); } catch (e) {}
    return true;
  } catch (e) { return false; }
}
export function initSync() {
  (async () => {
    const adopted = await pullState();   // server wins if it has anything
    if (!adopted) pushState();           // else seed the server from local/seed
  })();
  window.addEventListener("focus", pullState);
}

// ---- toast ----
let tT;
export function toast(m) { toastMsg.value = m; clearTimeout(tT); tT = setTimeout(() => (toastMsg.value = ""), 2200); }

// ---- pin mutations ----
export function addPin(p) { pins.value = [...pins.value, p]; save(); }
export function movePin(id, lat, lng) {
  pins.value = pins.value.map((p) => (p.id === id ? { ...p, lat: +lat.toFixed(6), lng: +lng.toFixed(6) } : p));
  save();
}
export function removePin(id) {
  const p = pins.value.find((x) => x.id === id); if (!p) return;
  if (!confirm(`Remove “${p.name}”?`)) return;
  pins.value = pins.value.filter((x) => x.id !== id);
  save();
}
export function savePin(fields, target) {
  // target = editing.value.pin (edit) or undefined (new)
  if (target) pins.value = pins.value.map((p) => (p.id === target.id ? { ...p, ...fields } : p));
  else pins.value = [...pins.value, { id: "p_" + Date.now().toString(36), src: null, ...fields }];
  save();
}
export function toggleCatalog(x) {
  if (onMap(x.cid)) {
    pins.value = pins.value.filter((p) => p.src !== x.cid);
    save(); toast(x.name + " removed from the map");
  } else {
    addPin({ id: "p_" + x.cid + "_" + Date.now().toString(36), name: x.name, lat: x.lat, lng: x.lng, cat: x.cat, note: x.note, url: x.url, src: x.cid });
    toast(x.name + " added to the map");
  }
}

// ---- category mutations ----
export function updateCat(id, patch) { cats.value = cats.value.map((c) => (c.id === id ? { ...c, ...patch } : c)); save(); }
export function addCat() {
  const palette = ["#c2410c", "#7c5cbf", "#0e7490", "#b45309", "#4d7c0f", "#9d174d"];
  cats.value = [...cats.value, { id: "cat_" + Date.now().toString(36), name: "New category", color: palette[cats.value.length % palette.length] }];
  save();
}
export function deleteCat(id) {
  if (cats.value.length <= 1) { toast("Keep at least one category"); return; }
  const idx = cats.value.findIndex((c) => c.id === id);
  const fallback = cats.value[idx === 0 ? 1 : idx - 1];
  const used = pins.value.filter((p) => p.cat === id).length;
  if (used && !confirm(`${used} pin(s) use this. Move them to “${fallback.name}” and delete?`)) return;
  pins.value = pins.value.map((p) => (p.cat === id ? { ...p, cat: fallback.id } : p));
  cats.value = cats.value.filter((c) => c.id !== id);
  save();
}

// ---- filters ----
export function toggleHidden(id) {
  const s = new Set(hidden.value);
  s.has(id) ? s.delete(id) : s.add(id);
  hidden.value = s;
}

// ---- reset / import / export ----
export function reset() {
  if (!confirm("Reset to the seeded set? Your added pins go.")) return;
  const s = freshState(trip.value); cats.value = s.categories; pins.value = s.pins; save(); toast("Reset");
}
export function exportJson() {
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), categories: cats.value, pins: pins.value }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `${trip.value.id}-map.json`; a.click(); URL.revokeObjectURL(a.href);
  toast(`Exported ${trip.value.id}-map.json`);
}
export function importFile(file) {
  const r = new FileReader();
  r.onload = () => {
    const txt = r.result;
    let json = null; try { json = JSON.parse(txt); } catch (_) {}
    if (json && Array.isArray(json.pins) && Array.isArray(json.categories)) importJson(json);
    else importCsv(txt);
  };
  r.readAsText(file);
}
function dupe(lat, lng, name) { return pins.value.some((p) => p.name === name && Math.abs(p.lat - lat) < 1e-4 && Math.abs(p.lng - lng) < 1e-4); }
function importJson(data) {
  if (!confirm("Merge with what's here?  OK = merge · Cancel = replace everything")) {
    cats.value = data.categories; pins.value = data.pins;
  } else {
    const nc = [...cats.value];
    data.categories.forEach((c) => { if (!nc.some((x) => x.id === c.id)) nc.push(c); });
    const np = [...pins.value];
    data.pins.forEach((p) => { if (!dupe(p.lat, p.lng, p.name)) np.push({ ...p, id: p.id || "p_" + Math.random().toString(36).slice(2) }); });
    cats.value = nc; pins.value = np;
  }
  save(); toast("Imported");
}

// Google Takeout CSV (Title,Note,URL,...). No coords in the file, so geocode
// each name via Nominatim — draggable pins fix any misses.
// ponytail: 1 req/sec per Nominatim usage policy; fine for a one-off list.
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  text = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") (row.push(field), (field = ""));
    else if (c === "\n") (row.push(field), rows.push(row), (row = []), (field = ""));
    else field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function geocode(name, hint) {
  const q = name.replace(/\([^)]*\)/g, "").replace(/\s*[-–|].*$/, "").trim() || name;
  try {
    const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(hint ? q + ", " + hint : q));
    const j = await res.json();
    if (j && j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
  } catch (_) {}
  return null;
}
async function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) { toast("Empty or unreadable CSV"); return; }
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const ti = head.indexOf("title"), ni = head.indexOf("note");
  if (ti < 0) { toast("No 'Title' column in that CSV"); return; }
  const items = rows.slice(1)
    .map((r) => ({ name: (r[ti] || "").trim(), note: ni >= 0 ? (r[ni] || "").trim() : "" }))
    .filter((it) => it.name && !pins.value.some((p) => p.name === it.name));
  if (!items.length) { toast("Nothing new to import"); return; }
  if (!cats.value.some((c) => c.id === "saved")) cats.value = [...cats.value, { id: "saved", name: "Saved", color: "#5b6672" }];
  const hint = trip.value.geocodeHint;
  const [clat, clng] = trip.value.geocodeCenter || trip.value.center;
  let added = 0, failed = 0;
  for (let i = 0; i < items.length; i++) {
    toast(`Locating ${i + 1}/${items.length}…`);
    const ll = await geocode(items[i].name, hint);
    let { name, note } = items[i], lat, lng;
    if (ll) { lat = ll.lat; lng = ll.lng; }
    else { lat = clat; lng = clng; note = (note ? note + " — " : "") + "⚠ auto-locate failed, drag me"; failed++; }
    if (!dupe(lat, lng, name)) { addPin({ id: "p_" + Math.random().toString(36).slice(2), name, lat, lng, cat: "saved", note, src: null }); added++; }
    if (i < items.length - 1) await sleep(1100);
  }
  toast(`Imported ${added} place${added === 1 ? "" : "s"} into “Saved”${failed ? ` · ${failed} need placing (dragged to centre)` : ""}`);
}

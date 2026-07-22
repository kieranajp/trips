import { cats, pins, trip } from "../../state/signals.js";
import { addPin, toast } from "../../state/actions.js";
import { save } from "../../state/persistence.js";

export function exportJson() {
  const data = JSON.stringify({
    version: 1,
    exported: new Date().toISOString(),
    categories: cats.value,
    pins: pins.value,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${trip.value.id}-map.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${trip.value.id}-map.json`);
}

export function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (json && Array.isArray(json.pins) && Array.isArray(json.categories)) importJson(json);
    else importCsv(text);
  };
  reader.readAsText(file);
}

function isDuplicate(lat, lng, name) {
  return pins.value.some((pin) => pin.name === name
    && Math.abs(pin.lat - lat) < 1e-4
    && Math.abs(pin.lng - lng) < 1e-4);
}

function importJson(data) {
  if (!confirm("Merge with what's here?  OK = merge · Cancel = replace everything")) {
    cats.value = data.categories;
    pins.value = data.pins;
  } else {
    const categories = [...cats.value];
    data.categories.forEach((category) => {
      if (!categories.some((existing) => existing.id === category.id)) categories.push(category);
    });
    const importedPins = [...pins.value];
    data.pins.forEach((pin) => {
      if (!isDuplicate(pin.lat, pin.lng, pin.name)) {
        importedPins.push({ ...pin, id: pin.id || "p_" + Math.random().toString(36).slice(2) });
      }
    });
    cats.value = categories;
    pins.value = importedPins;
  }
  save();
  toast("Imported");
}

// Exported for tests.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  text = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((fields) => fields.some((value) => value.trim() !== ""));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function geocode(name, hint) {
  const query = name.replace(/\([^)]*\)/g, "").replace(/\s*[-–|].*$/, "").trim() || name;
  try {
    const location = hint ? query + ", " + hint : query;
    const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(location));
    const data = await res.json();
    if (data?.[0]) return { lat: +data[0].lat, lng: +data[0].lon };
  } catch (_) {}
  return null;
}

async function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) { toast("Empty or unreadable CSV"); return; }
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const titleIndex = headers.indexOf("title");
  const noteIndex = headers.indexOf("note");
  if (titleIndex < 0) { toast("No 'Title' column in that CSV"); return; }
  const items = rows.slice(1)
    .map((row) => ({
      name: (row[titleIndex] || "").trim(),
      note: noteIndex >= 0 ? (row[noteIndex] || "").trim() : "",
    }))
    .filter((item) => item.name && !pins.value.some((pin) => pin.name === item.name));
  if (!items.length) { toast("Nothing new to import"); return; }
  if (!cats.value.some((category) => category.id === "saved")) {
    cats.value = [...cats.value, { id: "saved", name: "Saved", color: "#5b6672" }];
  }
  const hint = trip.value.geocodeHint;
  const [centerLat, centerLng] = trip.value.geocodeCenter || trip.value.center;
  let added = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    toast(`Locating ${i + 1}/${items.length}…`);
    const location = await geocode(items[i].name, hint);
    let { name, note } = items[i];
    let lat = location?.lat ?? centerLat;
    let lng = location?.lng ?? centerLng;
    if (!location) {
      note = (note ? note + " — " : "") + "⚠ auto-locate failed — edit to set location";
      failed++;
    }
    if (!isDuplicate(lat, lng, name)) {
      addPin({ id: "p_" + Math.random().toString(36).slice(2), name, lat, lng, cat: "saved", note, src: null });
      added++;
    }
    if (i < items.length - 1) await sleep(1100);
  }
  toast(`Imported ${added} place${added === 1 ? "" : "s"} into “Saved”${failed ? ` · ${failed} need placing (dragged to centre)` : ""}`);
}

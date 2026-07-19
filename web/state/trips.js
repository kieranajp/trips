import { cats, pins, trip, trips } from "./signals.js";
import { localLoad } from "./persistence.js";

const validId = (id) => /^[a-z0-9-]+$/.test(id || "");

export function freshState(def) {
  const seededPins = def.catalog
    .filter((item) => def.seedOnMap.includes(item.cid))
    .map((item) => ({
      id: "p_" + item.cid,
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      cat: item.cat,
      note: item.note,
      url: item.url,
      src: item.cid,
    }));
  return { categories: def.categories.map((category) => ({ ...category })), pins: seededPins };
}

async function loadTrips() {
  try {
    const res = await fetch("/trips/index.json");
    if (res.ok) trips.value = await res.json();
  } catch (_) {}
}

async function loadTrip(id) {
  if (!validId(id)) return null;
  try {
    const res = await fetch(`/trips/${id}.json`);
    if (res.ok) return await res.json();
  } catch (_) {}
  return null;
}

export async function boot() {
  const id = new URLSearchParams(location.search).get("trip");
  if (!id) return loadTrips();
  const definition = await loadTrip(id);
  if (!definition) {
    location.search = "";
    return;
  }
  trip.value = definition;
  document.title = `${definition.title} — ${definition.subtitle}`;
  const state = localLoad(id) || freshState(definition);
  cats.value = state.categories;
  pins.value = state.pins;
}

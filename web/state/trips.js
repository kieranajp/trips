import { areaErrors, areaOverride, cats, flights, pins, stays, trip, trips } from "./signals.js";
import { validateAreas } from "../lib/areas.js";
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
  return {
    areaOverride: null,
    categories: def.categories.map((category) => ({ ...category })),
    pins: seededPins,
    flights: (def.flights || []).map((flight) => ({ ...flight })),
    stays: (def.stays || []).map((stay) => ({ ...stay })),
  };
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
  const override = state.areaOverride == null ? { areas: null, errors: [] } : validateAreas(state.areaOverride);
  areaOverride.value = override.errors.length ? null : override.areas;
  areaErrors.value = override.errors;
  cats.value = state.categories;
  pins.value = state.pins;
  flights.value = state.flights || [];
  stays.value = state.stays || [];
}

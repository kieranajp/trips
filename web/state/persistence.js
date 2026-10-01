import { areaErrors, areaOverride, cats, flights, pins, stays, syncStatus, trip } from "./signals.js";
import { canEdit } from "./auth.js";
import { validateAreas } from "../lib/areas.js";

const lsKey = (id) => "trip_state_" + id;
const records = new Map();
export const snapshot = () => ({
  categories: cats.value,
  pins: pins.value,
  flights: flights.value,
  stays: stays.value,
  areaOverride: areaOverride.value,
});

export function localLoad(id) {
  try {
    const value = localStorage.getItem(lsKey(id));
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

const payload = ({ _sync, ...state }) => state;
const normalizedOverride = (state) => state.areaOverride == null
  ? { areas: null, errors: [] } : validateAreas(state.areaOverride);
const status = (id, state, message) => {
  if (trip.value?.id === id) syncStatus.value = { state, message };
};
function record(id) {
  if (!records.has(id)) records.set(id, { timer: null, running: null, generation: 0 });
  return records.get(id);
}
const pending = (id) => localLoad(id)?._sync?.pending === true;

export function commitCandidate(candidate, id = trip.value.id) {
  const checked = normalizedOverride(candidate);
  if (checked.errors.length) throw new Error("Cannot save invalid areas.");
  const state = { ...payload(candidate), areaOverride: checked.areas };
  const body = JSON.stringify(state);
  if (new TextEncoder().encode(body).length > 1024 * 1024) throw new Error("Complete trip state exceeds the 1 MiB limit.");
  const entry = record(id);
  const generation = Math.max(entry.generation, localLoad(id)?._sync?.generation || 0) + 1;
  localStorage.setItem(lsKey(id), JSON.stringify({ ...state, _sync: { generation, pending: true } }));
  entry.generation = generation;
  status(id, "pending", "Saved on this device; sync pending");
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => retrySync(id), 800);
  return state;
}

export function save() {
  try {
    commitCandidate(snapshot());
    return true;
  } catch (error) {
    status(trip.value.id, "error", `Could not save on this device: ${error.message}`);
    return false;
  }
}

export async function retrySync(id = trip.value?.id) {
  if (!id) return false;
  const entry = record(id);
  clearTimeout(entry.timer);
  if (entry.running) return entry.running;
  entry.running = pushPending(id);
  try { return await entry.running; }
  finally { entry.running = null; }
}

async function pushPending(id) {
  while (pending(id)) {
    if (!canEdit.value) {
      status(id, "error", "Saved on this device; sign in and retry sync.");
      return false;
    }
    const stored = localLoad(id);
    const checked = normalizedOverride(stored);
    if (checked.errors.length) {
      if (trip.value?.id === id) areaErrors.value = checked.errors;
      status(id, "error", "Saved areas are invalid; sync stopped.");
      return false;
    }
    const generation = stored._sync.generation;
    status(id, "pending", "Saved on this device; sync pending");
    try {
      const res = await fetch(`/state?trip=${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(stored)),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status || "an unauthorised response"}`);
      const latest = localLoad(id);
      if (latest?._sync?.generation !== generation) continue;
      localStorage.setItem(lsKey(id), JSON.stringify({ ...payload(latest), _sync: { generation, pending: false } }));
      status(id, "synced", "Synced");
      return true;
    } catch (error) {
      status(id, "error", `Saved on this device; sync failed. ${error.message}`);
      return false;
    }
  }
  return true;
}

export async function pullState() {
  const id = trip.value?.id;
  if (!id) return "skipped";
  if (pending(id)) {
    await retrySync(id);
    return "pending";
  }
  const entry = record(id);
  const generation = entry.generation;
  try {
    const res = await fetch(`/state?trip=${id}`);
    if (!res.ok) return "unavailable";
    const data = await res.json();
    if (trip.value?.id !== id || pending(id) || entry.generation !== generation) return "skipped";
    if (data && Object.keys(data).length === 0) return "empty";
    const checked = normalizedOverride(data || {});
    if (!data || !Array.isArray(data.pins) || !Array.isArray(data.categories) || checked.errors.length) {
      areaErrors.value = checked.errors.length ? checked.errors : [{ path: "state", code: "invalid", message: "Remote trip state is invalid." }];
      status(id, "error", "Remote state rejected; local state retained.");
      return "rejected";
    }
    const state = {
      categories: data.categories, pins: data.pins,
      flights: Array.isArray(data.flights) ? data.flights : [],
      stays: Array.isArray(data.stays) ? data.stays : [], areaOverride: checked.areas,
    };
    localStorage.setItem(lsKey(id), JSON.stringify({ ...state, _sync: { generation, pending: false } }));
    cats.value = state.categories;
    pins.value = state.pins;
    flights.value = state.flights;
    stays.value = state.stays;
    areaOverride.value = state.areaOverride;
    areaErrors.value = [];
    status(id, "synced", "Synced");
    return "adopted";
  } catch (error) {
    status(id, "error", `Could not load remote state: ${error.message}`);
    return "unavailable";
  }
}

export function initSync() {
  const ready = (async () => {
    const id = trip.value?.id;
    if (!id) return;
    if (pending(id)) return retrySync(id);
    const result = await pullState();
    if (result === "empty" && !areaErrors.value.length && canEdit.value && trip.value?.id === id) {
      if (save()) return retrySync(id);
    }
  })();
  window.addEventListener("focus", pullState);
  return ready;
}

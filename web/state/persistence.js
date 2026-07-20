import { cats, flights, pins, stays, trip } from "./signals.js";
import { canEdit } from "./auth.js";

const lsKey = (id) => "trip_state_" + id;

const snapshot = () => JSON.stringify({
  categories: cats.value,
  pins: pins.value,
  flights: flights.value,
  stays: stays.value,
});

export function localLoad(id) {
  try {
    const value = localStorage.getItem(lsKey(id));
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

let lastSynced = "";
let putTimer;

export function save() {
  const id = trip.value.id;
  const body = snapshot();
  try { localStorage.setItem(lsKey(id), body); } catch (_) {}
  clearTimeout(putTimer);
  putTimer = setTimeout(() => pushState(body), 800);
}

async function pushState(body = snapshot()) {
  if (body === lastSynced) return;
  // Writes require a login; the ingress rejects them otherwise. Skip the doomed
  // request when logged out — localStorage still holds the latest state.
  if (!canEdit.value) return;
  try {
    const res = await fetch(`/state?trip=${trip.value.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) lastSynced = body;
  } catch (_) {
    // localStorage holds the latest state; the next change will retry.
  }
}

async function pullState() {
  if (!trip.value) return false;
  try {
    const res = await fetch(`/state?trip=${trip.value.id}`);
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text === "{}" || text === lastSynced) return false;
    const data = JSON.parse(text);
    if (!Array.isArray(data.pins) || !Array.isArray(data.categories)) return false;
    lastSynced = text;
    cats.value = data.categories;
    pins.value = data.pins;
    flights.value = Array.isArray(data.flights) ? data.flights : [];
    stays.value = Array.isArray(data.stays) ? data.stays : [];
    try { localStorage.setItem(lsKey(trip.value.id), text); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export function initSync() {
  (async () => {
    const adopted = await pullState();
    if (!adopted) pushState();
  })();
  window.addEventListener("focus", pullState);
}

import { computed, signal } from "@preact/signals";

export const trips = signal([]);
export const trip = signal(null);
export const cats = signal([]);
export const pins = signal([]);
export const flights = signal([]);
export const stays = signal([]);
export const only = signal(null);
export const search = signal("");
export const tab = signal("map");
export const areasOn = signal(true);
export const editing = signal(null);
export const editingLog = signal(null); // { kind: "flight" | "stay", item? }
export const toastMsg = signal("");

export const catById = (id) => cats.value.find((c) => c.id === id) || cats.value[cats.value.length - 1];
export const onMap = (cid) => pins.value.some((p) => p.src === cid);

// Free-text pin match. Searches name + note; query is trimmed & lowercased.
export const pinMatches = (pin, query) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${pin.name || ""} ${pin.note || ""}`.toLowerCase().includes(q);
};

// Pins that match the free-text search. The filter chips count against this
// (a chip shows what it *would* display, ignoring which chip is active).
export const searchedPins = computed(() => pins.value.filter((pin) => pinMatches(pin, search.value)));

// ...and what the map markers and the sidebar list actually show: search AND
// the single-category filter. The one source of truth — map and list consume
// the same computed, so they can't drift.
export const visiblePins = computed(() =>
  searchedPins.value.filter((pin) => !only.value || pin.cat === only.value));

import { cats, editingLog, flights, only, pins, stays, toastMsg, trip, onMap } from "./signals.js";
import { save } from "./persistence.js";
import { freshState } from "./trips.js";
import { uid } from "../lib/uid.js";

let toastTimer;

export function toast(message) {
  toastMsg.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = ""), 2200);
}

// Pins, flights and stays all mutate the same way: patch-by-id or append with
// a fresh id, then persist; deletion is confirm-then-filter. One factory each,
// parameterised by the signal.
const upsert = (list, prefix, extra) => (fields, target) => {
  if (target) list.value = list.value.map((item) => (item.id === target.id ? { ...item, ...fields } : item));
  else list.value = [...list.value, { id: uid(prefix), ...extra, ...fields }];
  save();
};

const removeWithConfirm = (list, message) => (id) => {
  const item = list.value.find((entry) => entry.id === id);
  if (!item || !confirm(message(item))) return;
  list.value = list.value.filter((entry) => entry.id !== id);
  save();
};

export const savePin = upsert(pins, "p_", { src: null });
export const saveFlight = upsert(flights, "fl_");
export const saveStay = upsert(stays, "st_");

export const removePin = removeWithConfirm(pins, (pin) => `Remove “${pin.name}”?`);
export const removeFlight = removeWithConfirm(flights, () => "Remove this flight?");
export const removeStay = removeWithConfirm(stays, (stay) => `Remove “${stay.name}”?`);

export function addPin(pin) {
  pins.value = [...pins.value, pin];
  save();
}

export function toggleCatalog(item) {
  if (onMap(item.cid)) {
    pins.value = pins.value.filter((pin) => pin.src !== item.cid);
    save();
    toast(item.name + " removed from the map");
    return;
  }
  addPin({
    id: uid("p_" + item.cid + "_"),
    name: item.name,
    lat: item.lat,
    lng: item.lng,
    cat: item.cat,
    note: item.note,
    url: item.url,
    src: item.cid,
  });
  toast(item.name + " added to the map");
}

export function editLog(kind, item) {
  editingLog.value = { kind, item: item || null };
}

export function updateCat(id, patch) {
  cats.value = cats.value.map((category) => (category.id === id ? { ...category, ...patch } : category));
  save();
}

export function addCat() {
  const palette = ["#c2410c", "#7c5cbf", "#0e7490", "#b45309", "#4d7c0f", "#9d174d"];
  cats.value = [...cats.value, {
    id: uid("cat_"),
    name: "New category",
    color: palette[cats.value.length % palette.length],
  }];
  save();
}

export function deleteCat(id) {
  if (cats.value.length <= 1) {
    toast("Keep at least one category");
    return;
  }
  const index = cats.value.findIndex((category) => category.id === id);
  const fallback = cats.value[index === 0 ? 1 : index - 1];
  const used = pins.value.filter((pin) => pin.cat === id).length;
  if (used && !confirm(`${used} pin(s) use this. Move them to “${fallback.name}” and delete?`)) return;
  pins.value = pins.value.map((pin) => (pin.cat === id ? { ...pin, cat: fallback.id } : pin));
  cats.value = cats.value.filter((category) => category.id !== id);
  save();
}

export function toggleOnly(id) {
  only.value = only.value === id ? null : id;
}

export function reset() {
  if (!confirm("Reset to the seeded set? Your added pins go.")) return;
  const state = freshState(trip.value);
  cats.value = state.categories;
  pins.value = state.pins;
  flights.value = state.flights;
  stays.value = state.stays;
  save();
  toast("Reset");
}

import { cats, only, pins, toastMsg, trip, onMap } from "./signals.js";
import { save } from "./persistence.js";
import { freshState } from "./trips.js";

let toastTimer;

export function toast(message) {
  toastMsg.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = ""), 2200);
}

export function addPin(pin) {
  pins.value = [...pins.value, pin];
  save();
}

export function removePin(id) {
  const pin = pins.value.find((item) => item.id === id);
  if (!pin || !confirm(`Remove “${pin.name}”?`)) return;
  pins.value = pins.value.filter((item) => item.id !== id);
  save();
}

export function savePin(fields, target) {
  if (target) pins.value = pins.value.map((pin) => (pin.id === target.id ? { ...pin, ...fields } : pin));
  else pins.value = [...pins.value, { id: "p_" + Date.now().toString(36), src: null, ...fields }];
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
    id: "p_" + item.cid + "_" + Date.now().toString(36),
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

export function updateCat(id, patch) {
  cats.value = cats.value.map((category) => (category.id === id ? { ...category, ...patch } : category));
  save();
}

export function addCat() {
  const palette = ["#c2410c", "#7c5cbf", "#0e7490", "#b45309", "#4d7c0f", "#9d174d"];
  cats.value = [...cats.value, {
    id: "cat_" + Date.now().toString(36),
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
  save();
  toast("Reset");
}

import { signal } from "@preact/signals";

export const trips = signal([]);
export const trip = signal(null);
export const cats = signal([]);
export const pins = signal([]);
export const flights = signal([]);
export const stays = signal([]);
export const only = signal(null);
export const tab = signal("map");
export const areasOn = signal(true);
export const editing = signal(null);
export const editingLog = signal(null); // { kind: "flight" | "stay", item? }
export const toastMsg = signal("");

export const catById = (id) => cats.value.find((c) => c.id === id) || cats.value[cats.value.length - 1];
export const onMap = (cid) => pins.value.some((p) => p.src === cid);

// Pin permalinks: ?trip=<id>&pin=<id> deep-links straight to one pin's popup
// on the trip map. URL building/parsing and the "fly once the pin exists"
// logic live here so Node can test them; mountMap does the wiring.
import { effect } from "@preact/signals";
import { pins, trip } from "../../state/signals.js";
import { toast } from "../../state/actions.js";

export const pinPermalink = (tripId, pinId, base = globalThis.location) => {
  const params = new URLSearchParams({ trip: tripId, pin: pinId });
  return `${base.origin}${base.pathname}?${params}`;
};

// The shared pin can show up after mount: a first-time visitor renders the
// seed (or stale localStorage) while the server state is still in flight. So
// watch pins until the id appears, then fly exactly once. If it never
// appears — pin deleted since sharing — the idle watch just lingers.
export function followPermalink(map, search = location.search) {
  const pinId = new URLSearchParams(search).get("pin");
  if (!pinId) return;
  let stop = null;
  let done = false;
  stop = effect(() => {
    if (done) return;
    const pin = pins.value.find((item) => item.id === pinId);
    if (!pin) return;
    done = true;
    map.flyTo(pin);
    if (stop) stop();
  });
  if (done) stop();
}

// Share sheet where the browser has one, clipboard otherwise, prompt() as the
// last resort (plain http, denied permission).
export async function sharePin(pin, nav = navigator, base = globalThis.location) {
  const url = pinPermalink(trip.value.id, pin.id, base);
  if (nav.share) {
    try {
      await nav.share({ title: pin.name, url });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // user closed the sheet
    }
  }
  try {
    await nav.clipboard.writeText(url);
    toast("Link copied");
  } catch (_) {
    prompt("Copy this link:", url);
  }
}

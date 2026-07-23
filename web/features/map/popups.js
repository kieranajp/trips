// Popup HTML for the imperative Leaflet layer. Out here there's no Preact to
// escape for us — these are raw HTML strings — and everything interpolated is
// user state or imported JSON, i.e. untrusted. So: every value goes through
// escapeHtml, and hrefs only ever come out as http(s).
import { catById } from "../../state/signals.js";
import { canEdit } from "../../state/auth.js";
import { escapeHtml } from "../../lib/html.js";
import { fmtDay } from "../../lib/dates.js";

// A place's `url` can be any string (pasted link, imported file), so only
// http(s) is honoured; anything else (javascript:, data:, …) falls back to a
// Maps search by name.
export const mapsUrl = (place) => (/^https?:\/\//i.test(place.url || "")
  ? place.url
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name || "")}`);

export function pinPopupHtml(pin) {
  const category = catById(pin.cat);
  return `<div class="pop-tag" style="color:${escapeHtml(category.color)}">${escapeHtml(category.name)}</div>
    <div class="pop-nm">${escapeHtml(pin.name)}</div>
    ${pin.visitedAt ? `<div class="pop-visited">✓ Visited ${escapeHtml(fmtDay(pin.visitedAt))}</div>` : ""}
    ${pin.note ? `<p class="pop-nt">${escapeHtml(pin.note)}</p>` : ""}
    <div class="pop-links">
      <a href="${escapeHtml(mapsUrl(pin))}" target="_blank" rel="noopener">Open in Maps ↗</a>
      <button data-share="${escapeHtml(pin.id)}">Share</button>
      ${canEdit.value ? `<button data-visit="${escapeHtml(pin.id)}">${pin.visitedAt ? "Unvisit" : "Check off ✓"}</button>` : ""}
      ${canEdit.value ? `<button data-edit="${escapeHtml(pin.id)}">Edit</button>` : ""}
    </div>`;
}

export function stayPopupHtml(stay) {
  return `<div class="pop-tag" style="color:#1c2321">Your stay</div>
    <div class="pop-nm">${escapeHtml(stay.name)}</div>
    ${stay.address ? `<p class="pop-nt">${escapeHtml(stay.address)}</p>` : ""}
    <div class="pop-links"><a href="${escapeHtml(mapsUrl(stay))}" target="_blank" rel="noopener">Open in Maps ↗</a></div>`;
}

export function neighbourhoodPopupHtml(neighbourhood) {
  return `<div class="pop-tag" style="color:${escapeHtml(neighbourhood.color)}">Neighbourhood</div>
    <div class="pop-nm">${escapeHtml(neighbourhood.name)}</div><p class="pop-nt">${escapeHtml(neighbourhood.note)}</p>`;
}

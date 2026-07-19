// Leaflet lives outside the component tree. It reacts to signals via effect(),
// and reads the active trip definition for center/zoom/base/neighbourhoods.
import { effect } from "@preact/signals";
import { pins, cats, hidden, areasOn, placing, editing, trip, catById, movePin } from "./state.js";
import { esc } from "./util.js";

const L = window.L;
let map, markerLayer, nbLayer;
const markers = {};

function pinIcon(color) {
  return L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24],
    html: `<div class="pin"><svg width="26" height="26" viewBox="0 0 26 26">
      <path d="M13 25C13 25 23 15.5 23 9.5C23 3.7 18.5 0 13 0C7.5 0 3 3.7 3 9.5C3 15.5 13 25 13 25Z" fill="${color}" stroke="#f3efe6" stroke-width="1.4"/>
      <circle cx="13" cy="9.5" r="4.4" fill="#f3efe6"/></svg></div>` });
}
// Prefer a place's own Google URL (exact card, one click); else search by name.
const mapsUrl = (p) => p.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
function popupHtml(p) {
  const c = catById(p.cat);
  return `<div class="pop-tag" style="color:${c.color}">${esc(c.name)}</div>
    <div class="pop-nm">${esc(p.name)}</div>
    ${p.note ? `<p class="pop-nt">${esc(p.note)}</p>` : ""}
    <div class="pop-links">
      <a href="${mapsUrl(p)}" target="_blank" rel="noopener">Open in Maps ↗</a>
      <button data-edit="${p.id}">Edit</button>
    </div>`;
}

function renderMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  for (const k in markers) delete markers[k];
  pins.value.forEach((p) => {
    if (hidden.value.has(p.cat)) return;
    const c = catById(p.cat);
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(c.color), draggable: true }).addTo(markerLayer);
    m.bindPopup(popupHtml(p));
    m.on("dragend", (e) => { const ll = e.target.getLatLng(); movePin(p.id, ll.lat, ll.lng); });
    m.on("popupopen", (ev) => {
      const b = ev.popup._contentNode.querySelector("[data-edit]");
      if (b) b.onclick = () => { map.closePopup(); editing.value = { pin: pins.value.find((x) => x.id === p.id) }; };
    });
    markers[p.id] = m;
  });
}

export function mountMap(el) {
  if (map) return;
  const def = trip.value;
  map = L.map(el, { zoomControl: true });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19, subdomains: "abcd", attribution: "&copy; OpenStreetMap, &copy; CARTO",
  }).addTo(map);
  map.setView(def.center, def.zoom);

  // base ("your hotel") marker
  if (def.base) {
    const b = def.base;
    const homeIcon = L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 33], popupAnchor: [0, -30],
      html: `<div class="home"><svg width="34" height="34" viewBox="0 0 34 34">
        <path d="M17 33 C17 33 30 20 30 12 C30 5 24 0 17 0 C10 0 4 5 4 12 C4 20 17 33 17 33 Z" fill="#1c2321" stroke="#f3efe6" stroke-width="1.5"/>
        <path d="M11.5 13.6 L17 9 L22.5 13.6 M13 12.7 V18 H21 V12.7" fill="none" stroke="#f3efe6" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      </svg></div>` });
    L.marker([b.lat, b.lng], { icon: homeIcon, zIndexOffset: 1000 }).addTo(map)
      .bindPopup(`<div class="pop-tag" style="color:#1c2321">Your base</div>
        <div class="pop-nm">${esc(b.name)}</div>
        ${b.note ? `<p class="pop-nt">${esc(b.note)}</p>` : ""}
        <div class="pop-links"><a href="${mapsUrl(b)}" target="_blank" rel="noopener">Open in Maps ↗</a></div>`);
  }

  // neighbourhood fences
  nbLayer = L.layerGroup();
  (def.neighbourhoods || []).forEach((n) => {
    const poly = L.polygon(n.ring, { color: n.color, weight: 1.6, dashArray: "5 5", fillColor: n.color, fillOpacity: 0.1 });
    poly.bindPopup(`<div class="pop-tag" style="color:${n.color}">Neighbourhood</div>
      <div class="pop-nm">${esc(n.name)}</div><p class="pop-nt">${esc(n.note)}</p>`, { maxWidth: 250 });
    poly.bindTooltip(n.name, { permanent: true, direction: "center", className: "nb-label" });
    nbLayer.addLayer(poly);
  });

  markerLayer = L.layerGroup().addTo(map);

  map.on("click", (e) => {
    if (!placing.value) return;
    placing.value = false;
    editing.value = { latlng: e.latlng };
  });

  // reactive wiring
  effect(renderMarkers);                                                    // pins / cats / hidden
  effect(() => { areasOn.value ? nbLayer.addTo(map) : map.removeLayer(nbLayer); });
  effect(() => { map.getContainer().style.cursor = placing.value ? "crosshair" : ""; });

  fitAll();
}

export function invalidate() { if (map) setTimeout(() => map.invalidateSize(), 60); }
export function getCenter() { return map.getCenter(); }
export function flyTo(p) { map.setView([p.lat, p.lng], 16); const m = markers[p.id]; if (m) m.openPopup(); }
export function fitAll() {
  if (!map) return;
  const pts = pins.value.map((p) => [p.lat, p.lng]);
  if (trip.value.base) pts.push([trip.value.base.lat, trip.value.base.lng]);
  if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
}

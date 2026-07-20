import { effect } from "@preact/signals";
import { areasOn, catById, editing, only, pins, stays, trip } from "../../state/signals.js";
import { canEdit } from "../../state/auth.js";

const L = window.L;
let map;
let markerLayer;
let stayLayer;
let neighbourhoodLayer;
const markers = {};

const hasCoords = (place) => place
  && place.lat != null && place.lng != null
  && !Number.isNaN(+place.lat) && !Number.isNaN(+place.lng);

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}[character]));

function pinIcon(color) {
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
    html: `<div class="pin"><svg width="26" height="26" viewBox="0 0 26 26">
      <path d="M13 25C13 25 23 15.5 23 9.5C23 3.7 18.5 0 13 0C7.5 0 3 3.7 3 9.5C3 15.5 13 25 13 25Z" fill="${color}" stroke="#f3efe6" stroke-width="1.4"/>
      <circle cx="13" cy="9.5" r="4.4" fill="#f3efe6"/></svg></div>`,
  });
}

const mapsUrl = (pin) => pin.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pin.name)}`;

function popupHtml(pin) {
  const category = catById(pin.cat);
  return `<div class="pop-tag" style="color:${category.color}">${escapeHtml(category.name)}</div>
    <div class="pop-nm">${escapeHtml(pin.name)}</div>
    ${pin.note ? `<p class="pop-nt">${escapeHtml(pin.note)}</p>` : ""}
    <div class="pop-links">
      <a href="${mapsUrl(pin)}" target="_blank" rel="noopener">Open in Maps ↗</a>
      ${canEdit.value ? `<button data-edit="${pin.id}">Edit</button>` : ""}
    </div>`;
}

function renderMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  for (const id in markers) delete markers[id];
  pins.value.forEach((pin) => {
    if (only.value && pin.cat !== only.value) return;
    const category = catById(pin.cat);
    const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(category.color) }).addTo(markerLayer);
    marker.bindPopup(popupHtml(pin));
    marker.on("popupopen", (event) => {
      const button = event.popup._contentNode.querySelector("[data-edit]");
      if (button) button.onclick = () => {
        map.closePopup();
        editing.value = { pin: pins.value.find((item) => item.id === pin.id) };
      };
    });
    markers[pin.id] = marker;
  });
}

function homeIcon() {
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 33],
    popupAnchor: [0, -30],
    html: `<div class="home"><svg width="34" height="34" viewBox="0 0 34 34">
      <path d="M17 33 C17 33 30 20 30 12 C30 5 24 0 17 0 C10 0 4 5 4 12 C4 20 17 33 17 33 Z" fill="#1c2321" stroke="#f3efe6" stroke-width="1.5"/>
      <path d="M11.5 13.6 L17 9 L22.5 13.6 M13 12.7 V18 H21 V12.7" fill="none" stroke="#f3efe6" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    </svg></div>`,
  });
}

// A stay with coordinates *is* the map's home marker — same thing, one source.
function renderStays() {
  if (!stayLayer) return;
  stayLayer.clearLayers();
  stays.value.forEach((stay) => {
    if (!hasCoords(stay)) return;
    L.marker([+stay.lat, +stay.lng], { icon: homeIcon(), zIndexOffset: 1000 }).addTo(stayLayer)
      .bindPopup(`<div class="pop-tag" style="color:#1c2321">Your stay</div>
        <div class="pop-nm">${escapeHtml(stay.name)}</div>
        ${stay.address ? `<p class="pop-nt">${escapeHtml(stay.address)}</p>` : ""}
        <div class="pop-links"><a href="${mapsUrl(stay)}" target="_blank" rel="noopener">Open in Maps ↗</a></div>`);
  });
}

function buildNeighbourhoodLayer(definition) {
  const layer = L.layerGroup();
  (definition.neighbourhoods || []).forEach((neighbourhood) => {
    const polygon = L.polygon(neighbourhood.ring, {
      color: neighbourhood.color,
      weight: 1.6,
      dashArray: "5 5",
      fillColor: neighbourhood.color,
      fillOpacity: 0.1,
    });
    polygon.bindPopup(`<div class="pop-tag" style="color:${neighbourhood.color}">Neighbourhood</div>
      <div class="pop-nm">${escapeHtml(neighbourhood.name)}</div><p class="pop-nt">${escapeHtml(neighbourhood.note)}</p>`, { maxWidth: 250 });
    polygon.bindTooltip(neighbourhood.name, { permanent: true, direction: "center", className: "nb-label" });
    layer.addLayer(polygon);
  });
  return layer;
}

export function mountMap(element) {
  if (map) return;
  const definition = trip.value;
  map = L.map(element, { zoomControl: true });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: "&copy; OpenStreetMap, &copy; CARTO",
  }).addTo(map);
  map.setView(definition.center, definition.zoom);
  neighbourhoodLayer = buildNeighbourhoodLayer(definition);
  stayLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  effect(renderMarkers);
  effect(renderStays);
  effect(() => { areasOn.value ? neighbourhoodLayer.addTo(map) : map.removeLayer(neighbourhoodLayer); });
  fitAll();
}

export function invalidate() {
  if (map) setTimeout(() => map.invalidateSize(), 60);
}

export function flyTo(pin) {
  map.setView([pin.lat, pin.lng], 16);
  markers[pin.id]?.openPopup();
}

function fitAll() {
  const points = pins.value.map((pin) => [pin.lat, pin.lng]);
  stays.value.forEach((stay) => { if (hasCoords(stay)) points.push([+stay.lat, +stay.lng]); });
  if (points.length) map.fitBounds(points, { padding: [50, 50], maxZoom: 15 });
}

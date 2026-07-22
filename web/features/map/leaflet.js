import { effect } from "@preact/signals";
import { areasOn, catById, editing, pins, stays, trip, visiblePins } from "../../state/signals.js";
import { escapeHtml } from "../../lib/html.js";
import { homeIconSpec, pinIconSpec } from "./icons.js";
import { neighbourhoodPopupHtml, pinPopupHtml, stayPopupHtml } from "./popups.js";
import { followPermalink, sharePin } from "./permalink.js";

const hasCoords = (place) => place
  && place.lat != null && place.lng != null
  && !Number.isNaN(+place.lat) && !Number.isNaN(+place.lng);

// createTripMap owns one Leaflet map: base tiles, the marker/stay/
// neighbourhood layers, and the signal effects that keep them in sync with
// state. Leaflet stays imperative and outside the Preact tree (see AGENTS.md);
// this factory just gives that code a boundary — no module globals, effects
// disposed on destroy(), and L injectable so tests can drive it with a fake.
export function createTripMap(element, definition, L = window.L) {
  const map = L.map(element, { zoomControl: true });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: "&copy; OpenStreetMap, &copy; CARTO",
  }).addTo(map);
  map.setView(definition.center, definition.zoom);

  const stayLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const neighbourhoodLayer = L.layerGroup();
  (definition.neighbourhoods || []).forEach((neighbourhood) => {
    const polygon = L.polygon(neighbourhood.ring, {
      color: neighbourhood.color,
      weight: 1.6,
      dashArray: "5 5",
      fillColor: neighbourhood.color,
      fillOpacity: 0.1,
    });
    polygon.bindPopup(neighbourhoodPopupHtml(neighbourhood), { maxWidth: 250 });
    polygon.bindTooltip(escapeHtml(neighbourhood.name), { permanent: true, direction: "center", className: "nb-label" });
    neighbourhoodLayer.addLayer(polygon);
  });

  const markers = {};

  function renderMarkers() {
    markerLayer.clearLayers();
    for (const id in markers) delete markers[id];
    visiblePins.value.forEach((pin) => {
      const icon = L.divIcon(pinIconSpec(catById(pin.cat).color));
      const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(markerLayer);
      marker.bindPopup(pinPopupHtml(pin));
      marker.on("popupopen", (event) => {
        const content = event.popup._contentNode;
        const editButton = content.querySelector("[data-edit]");
        if (editButton) editButton.onclick = () => {
          map.closePopup();
          editing.value = { pin: pins.value.find((item) => item.id === pin.id) };
        };
        const shareButton = content.querySelector("[data-share]");
        if (shareButton) shareButton.onclick = () => sharePin(pin);
      });
      markers[pin.id] = marker;
    });
  }

  // A stay with coordinates *is* the map's home marker — same thing, one source.
  function renderStays() {
    stayLayer.clearLayers();
    stays.value.forEach((stay) => {
      if (!hasCoords(stay)) return;
      L.marker([+stay.lat, +stay.lng], { icon: L.divIcon(homeIconSpec()), zIndexOffset: 1000 })
        .addTo(stayLayer)
        .bindPopup(stayPopupHtml(stay));
    });
  }

  function fitAll() {
    const points = pins.value.map((pin) => [pin.lat, pin.lng]);
    stays.value.forEach((stay) => { if (hasCoords(stay)) points.push([+stay.lat, +stay.lng]); });
    if (points.length) map.fitBounds(points, { padding: [50, 50], maxZoom: 15 });
  }

  const disposers = [
    effect(renderMarkers),
    effect(renderStays),
    effect(() => { areasOn.value ? neighbourhoodLayer.addTo(map) : map.removeLayer(neighbourhoodLayer); }),
  ];
  fitAll();

  return {
    flyTo(pin) {
      map.setView([pin.lat, pin.lng], 16);
      markers[pin.id]?.openPopup();
    },
    invalidate() {
      setTimeout(() => map.invalidateSize(), 60);
    },
    // Immediate size recalculation — used while dragging the mobile sheet,
    // where a deferred invalidate would lag the gesture.
    resize() {
      map.invalidateSize();
    },
    destroy() {
      disposers.splice(0).forEach((dispose) => dispose());
      map.remove();
    },
  };
}

// The app runs one map at a time (trip switching is a full page reload), so
// the components talk to a singleton through these thin entry points. All the
// behaviour lives in createTripMap above.
let instance = null;

export function mountMap(element) {
  if (!instance) {
    instance = createTripMap(element, trip.value);
    followPermalink(instance);
  }
  return instance;
}

export function invalidate() { instance?.invalidate(); }
export function resizeMap() { instance?.resize(); }
export function flyTo(pin) { instance?.flyTo(pin); }

import { effect } from "@preact/signals";
import { areasOn, catById, effectiveAreas, editing, pins, stays, trip, visiblePins } from "../../state/signals.js";
import { toggleVisited } from "../../state/actions.js";
import { escapeHtml } from "../../lib/html.js";
import { homeIconSpec, pinIconSpec } from "./icons.js";
import { neighbourhoodPopupHtml, pinPopupHtml, stayPopupHtml } from "./popups.js";
import { followPermalink, sharePin } from "./permalink.js";

const hasCoords = (place) => place
  && place.lat != null && place.lng != null
  && !Number.isNaN(+place.lat) && !Number.isNaN(+place.lng);

export function createTripMap(element, definition, L = window.L, areaSource = null) {
  const map = L.map(element, { zoomControl: true });
  const env = typeof window !== "undefined" ? window.ENV : null;
  const tileUrl = env?.cartoApiKey
    ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(env.cartoApiKey)}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  L.tileLayer(tileUrl, {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' + (env?.cartoApiKey ? ", &copy; CARTO" : ""),
  }).addTo(map);
  map.setView(definition.center, definition.zoom);

  const stayLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const neighbourhoodLayer = L.layerGroup();
  let areaPolygons = [];
  let activeArea = null;
  let selectedArea = null;
  let hoveredArea = null;
  let otherPopup = null;
  let leaveTimer = null;
  let cardCleanup = null;
  const suppressed = new Set();

  function cancelLeave() {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }

  function dismissArea(suppress = false) {
    cancelLeave();
    if (suppress && hoveredArea) suppressed.add(hoveredArea);
    const previous = activeArea;
    activeArea = selectedArea = null;
    cardCleanup?.();
    cardCleanup = null;
    if (previous) {
      previous.polygon.setStyle({ weight: 1.6, fillOpacity: 0.1 });
      previous.polygon.closePopup();
    }
  }

  function scheduleLeave() {
    cancelLeave();
    if (selectedArea) return;
    leaveTimer = setTimeout(() => {
      if (!selectedArea) dismissArea();
    }, 180);
  }

  function openArea(entry, persistent = false) {
    if (!persistent && (selectedArea || otherPopup || suppressed.has(entry))) return;
    cancelLeave();
    if (activeArea !== entry) dismissArea();
    activeArea = entry;
    if (persistent) selectedArea = entry;
    entry.polygon.setStyle({ weight: 3, fillOpacity: 0.22 });
    entry.polygon.openPopup();
  }

  function onPopupOpen(event) {
    const entry = areaPolygons.find((item) => item.polygon.getPopup() === event.popup);
    if (!entry) {
      otherPopup = event.popup;
      dismissArea();
      return;
    }
    otherPopup = null;
    cardCleanup?.();
    const card = event.popup.getElement();
    const enter = () => cancelLeave();
    const leave = () => scheduleLeave();
    card?.addEventListener("mouseenter", enter);
    card?.addEventListener("mouseleave", leave);
    cardCleanup = () => {
      card?.removeEventListener("mouseenter", enter);
      card?.removeEventListener("mouseleave", leave);
    };
  }

  function onPopupClose(event) {
    if (event.popup === otherPopup) otherPopup = null;
    if (activeArea?.polygon.getPopup() === event.popup) dismissArea(true);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") dismissArea(true);
  }

  function renderLabels() {
    areaPolygons.forEach(({ area, polygon }) => {
      const show = map.getZoom() >= (area.labelMinZoom ?? 0);
      if (!show) polygon.unbindTooltip();
      else if (!polygon.getTooltip()) {
        polygon.bindTooltip(escapeHtml(area.label || area.name), {
          permanent: true, direction: "center", className: "nb-label", interactive: false,
        });
        if (area.labelAt) polygon.getTooltip().setLatLng(area.labelAt);
      }
    });
  }

  function clearAreas() {
    dismissArea();
    hoveredArea = null;
    suppressed.clear();
    areaPolygons.forEach(({ polygon }) => {
      polygon.closePopup();
      polygon.unbindPopup();
      polygon.unbindTooltip();
      polygon.off();
    });
    areaPolygons = [];
    neighbourhoodLayer.clearLayers();
  }

  function renderAreas() {
    const areas = areaSource ? areaSource.value : definition.neighbourhoods || [];
    clearAreas();
    areas.forEach((area) => {
      const polygon = L.polygon(area.ring, {
        color: area.color, weight: 1.6, dashArray: "5 5",
        fillColor: area.color, fillOpacity: 0.1,
      });
      const entry = { area, polygon };
      polygon.bindPopup(neighbourhoodPopupHtml(area), { maxWidth: 300, className: "area-popup", autoPan: false, closeOnEscapeKey: false });
      polygon.on("mouseover", () => {
        hoveredArea = entry;
        openArea(entry);
      });
      polygon.on("mouseout", () => {
        if (hoveredArea === entry) hoveredArea = null;
        suppressed.delete(entry);
        if (activeArea === entry) scheduleLeave();
      });
      polygon.on("click", () => openArea(entry, true));
      polygon.on("tooltipopen", () => {
        if (area.labelAt) polygon.getTooltip().setLatLng(area.labelAt);
      });
      neighbourhoodLayer.addLayer(polygon);
      areaPolygons.push(entry);
    });
    renderLabels();
  }

  map.on("popupopen", onPopupOpen);
  map.on("popupclose", onPopupClose);
  map.on("zoomend", renderLabels);
  const keyboardTarget = typeof document !== "undefined" ? document : null;
  keyboardTarget?.addEventListener("keydown", onKeyDown);

  const markers = {};

  function renderMarkers() {
    markerLayer.clearLayers();
    for (const id in markers) delete markers[id];
    visiblePins.value.forEach((pin) => {
      const icon = L.divIcon(pinIconSpec(catById(pin.cat).color, !!pin.visitedAt));
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
        const visitButton = content.querySelector("[data-visit]");
        if (visitButton) visitButton.onclick = () => {
          const current = pins.value.find((item) => item.id === pin.id);
          if (current) toggleVisited(current);
        };
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
    effect(renderAreas),
    effect(renderMarkers),
    effect(renderStays),
    effect(() => {
      if (areasOn.value) neighbourhoodLayer.addTo(map);
      else {
        dismissArea();
        suppressed.clear();
        hoveredArea = null;
        map.removeLayer(neighbourhoodLayer);
      }
    }),
  ];
  fitAll();

  return {
    showArea(id) {
      const entry = areaPolygons.find((item) => item.area.id === id);
      if (!entry) return;
      areasOn.value = true;
      map.fitBounds(entry.polygon.getBounds(), { padding: [40, 40], maxZoom: 16 });
      openArea(entry, true);
    },
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
      clearAreas();
      map.off("popupopen", onPopupOpen);
      map.off("popupclose", onPopupClose);
      map.off("zoomend", renderLabels);
      keyboardTarget?.removeEventListener("keydown", onKeyDown);
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
    instance = createTripMap(element, trip.value, window.L, effectiveAreas);
    followPermalink(instance);
  }
  return instance;
}

export function invalidate() { instance?.invalidate(); }
export function resizeMap() { instance?.resize(); }
export function flyTo(pin) { instance?.flyTo(pin); }

export function showArea(id) { instance?.showArea(id); }

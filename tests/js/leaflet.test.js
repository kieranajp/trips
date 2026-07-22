import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authUser } from "../../web/state/auth.js";
import { areasOn, cats, editing, only, pins, search, stays, trip } from "../../web/state/signals.js";
import { createTripMap } from "../../web/features/map/leaflet.js";

// A recording fake of the slice of the Leaflet API createTripMap touches.
// Layer groups are captured in creation order: [0] stays, [1] markers,
// [2] neighbourhoods (matching the factory).
function fakeLeaflet() {
  const created = { groups: [], markers: [], polygons: [] };
  const map = {
    layers: new Set(),
    views: [],
    fitted: null,
    invalidated: 0,
    popupsClosed: 0,
    removed: false,
    setView(center, zoom) { this.views.push({ center, zoom }); },
    fitBounds(points, opts) { this.fitted = { points, opts }; },
    removeLayer(layer) { this.layers.delete(layer); },
    closePopup() { this.popupsClosed++; },
    invalidateSize() { this.invalidated++; },
    remove() { this.removed = true; },
  };
  const L = {
    map: () => map,
    tileLayer: () => ({ addTo() { return this; } }),
    divIcon: (spec) => ({ spec }),
    layerGroup() {
      const group = {
        items: [],
        addTo(target) { target.layers.add(this); return this; },
        addLayer(item) { this.items.push(item); },
        clearLayers() { this.items.length = 0; },
      };
      created.groups.push(group);
      return group;
    },
    marker(latlng, opts) {
      const marker = {
        latlng,
        opts,
        popup: null,
        events: {},
        openedCount: 0,
        addTo(group) { group.addLayer(this); return this; },
        bindPopup(html) { this.popup = html; return this; },
        on(name, handler) { this.events[name] = handler; return this; },
        openPopup() { this.openedCount++; },
      };
      created.markers.push(marker);
      return marker;
    },
    polygon(ring, opts) {
      const polygon = {
        ring,
        opts,
        bindPopup(html) { this.popup = html; return this; },
        bindTooltip(text) { this.tooltip = text; return this; },
      };
      created.polygons.push(polygon);
      return polygon;
    },
  };
  return { L, map, created };
}

const definition = {
  center: [43.263, -2.935],
  zoom: 12,
  neighbourhoods: [
    { name: "Casco Viejo", color: "#c26b3d", note: "old town", ring: [[43.25, -2.92], [43.26, -2.92], [43.26, -2.93]] },
  ],
};

const mount = () => {
  const fake = fakeLeaflet();
  const tripMap = createTripMap({}, definition, fake.L);
  return { ...fake, tripMap, markerGroup: fake.created.groups[1], stayGroup: fake.created.groups[0] };
};

beforeEach(() => {
  cats.value = [
    { id: "pintxos", name: "Pintxos", color: "#d9822b" },
    { id: "sights", name: "Sights", color: "#3f6ea3" },
  ];
  pins.value = [
    { id: "p_1", name: "Gure Toki", note: "tortilla", lat: 43.259, lng: -2.922, cat: "pintxos" },
    { id: "p_2", name: "Guggenheim", note: "", lat: 43.268, lng: -2.934, cat: "sights" },
  ];
  stays.value = [{ id: "st_1", name: "Hotel", lat: "43.2678", lng: "-2.9281" }];
  search.value = "";
  only.value = null;
  areasOn.value = true;
  editing.value = null;
  authUser.value = null;
  trip.value = null;
});

test("mount sets the initial view and renders a marker per pin", () => {
  const { map, markerGroup } = mount();
  assert.deepEqual(map.views[0], { center: definition.center, zoom: definition.zoom });
  assert.equal(markerGroup.items.length, 2);
  assert.deepEqual(markerGroup.items[0].latlng, [43.259, -2.922]);
  assert.ok(markerGroup.items[0].popup.includes("Gure Toki"));
});

test("markers take their colour from the pin's category", () => {
  const { markerGroup } = mount();
  assert.ok(markerGroup.items[0].opts.icon.spec.html.includes("#d9822b"));
  assert.ok(markerGroup.items[1].opts.icon.spec.html.includes("#3f6ea3"));
});

test("markers re-render when the search or category filter changes", () => {
  const { markerGroup } = mount();
  search.value = "tortilla";
  assert.deepEqual(markerGroup.items.map((marker) => marker.latlng), [[43.259, -2.922]]);
  search.value = "";
  only.value = "sights";
  assert.deepEqual(markerGroup.items.map((marker) => marker.latlng), [[43.268, -2.934]]);
  only.value = null;
  assert.equal(markerGroup.items.length, 2);
});

test("stays with coordinates render as home markers; ones without are skipped", () => {
  const { stayGroup } = mount();
  assert.equal(stayGroup.items.length, 1);
  assert.deepEqual(stayGroup.items[0].latlng, [43.2678, -2.9281]); // strings coerced
  assert.ok(stayGroup.items[0].popup.includes("Hotel"));

  stays.value = [{ id: "st_2", name: "No coords yet" }];
  assert.equal(stayGroup.items.length, 0);
});

test("mount fits bounds around pins and stays together", () => {
  const { map } = mount();
  assert.equal(map.fitted.points.length, 3); // 2 pins + 1 stay
  assert.deepEqual(map.fitted.points[2], [43.2678, -2.9281]);
  assert.equal(map.fitted.opts.maxZoom, 15);
});

test("mount with nothing to show never calls fitBounds", () => {
  pins.value = [];
  stays.value = [];
  const { map } = mount();
  assert.equal(map.fitted, null);
});

test("flyTo zooms to the pin and opens its popup, and survives filtered-out pins", () => {
  const { map, tripMap, markerGroup } = mount();
  tripMap.flyTo(pins.value[1]);
  assert.deepEqual(map.views.at(-1), { center: [43.268, -2.934], zoom: 16 });
  assert.equal(markerGroup.items[1].openedCount, 1);

  only.value = "pintxos"; // p_2 filtered off the map
  tripMap.flyTo(pins.value[1]); // no marker to open — must not throw
  assert.deepEqual(map.views.at(-1), { center: [43.268, -2.934], zoom: 16 });
});

test("the areas toggle adds and removes the neighbourhood layer", () => {
  const { map, created } = mount();
  const neighbourhoods = created.groups[2];
  assert.equal(neighbourhoods.items.length, 1);
  assert.ok(created.polygons[0].popup.includes("Casco Viejo"));
  assert.ok(map.layers.has(neighbourhoods));
  areasOn.value = false;
  assert.ok(!map.layers.has(neighbourhoods));
  areasOn.value = true;
  assert.ok(map.layers.has(neighbourhoods));
});

// Stand-in for the popup's DOM: one element per data-attribute button.
const fakePopupContent = (buttons) => ({
  popup: { _contentNode: { querySelector: (selector) => buttons[selector] || null } },
});

test("the popup Edit button closes the popup and opens the pin editor", () => {
  const { map, markerGroup } = mount();
  const marker = markerGroup.items[0];
  const button = {};
  marker.events.popupopen(fakePopupContent({ "[data-edit]": button }));
  button.onclick();
  assert.equal(map.popupsClosed, 1);
  assert.equal(editing.value.pin.id, "p_1");
});

test("the popup Share button hands the visitor a permalink (prompt fallback in Node)", async () => {
  trip.value = { id: "bilbao" };
  globalThis.location = { origin: "https://trips.example", pathname: "/" };
  const prompts = [];
  globalThis.prompt = (_message, url) => { prompts.push(url); };
  try {
    const { markerGroup } = mount();
    const button = {};
    markerGroup.items[0].events.popupopen(fakePopupContent({ "[data-share]": button }));
    await button.onclick(); // Node's navigator has no share/clipboard → prompt
    assert.deepEqual(prompts, ["https://trips.example/?trip=bilbao&pin=p_1"]);
  } finally {
    delete globalThis.location;
    delete globalThis.prompt;
  }
});

test("destroy disposes the effects and removes the map", () => {
  const { map, tripMap, markerGroup } = mount();
  tripMap.destroy();
  assert.equal(map.removed, true);
  const before = markerGroup.items.length;
  search.value = "tortilla"; // must no longer re-render markers
  assert.equal(markerGroup.items.length, before);
});

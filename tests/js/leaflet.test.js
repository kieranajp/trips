import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signal } from "@preact/signals";
import { authUser } from "../../web/state/auth.js";
import { areasOn, cats, editing, only, pins, search, stays, trip } from "../../web/state/signals.js";
import { createTripMap } from "../../web/features/map/leaflet.js";

// A recording fake of the slice of the Leaflet API createTripMap touches.
// Layer groups are captured in creation order: [0] stays, [1] markers,
// [2] neighbourhoods (matching the factory).
function fakeLeaflet() {
  const created = { groups: [], markers: [], polygons: [], tiles: [] };
  const listeners = {};
  const emit = (name, event) => listeners[name]?.(event);
  const popupElement = () => {
    const handlers = {};
    return {
      handlers,
      addEventListener(name, handler) { handlers[name] = handler; },
      removeEventListener(name) { delete handlers[name]; },
    };
  };
  const map = {
    layers: new Set(),
    zoom: 12,
    currentPopup: null,
    on(name, handler) { listeners[name] = handler; return this; },
    off(name) { delete listeners[name]; },
    emit,
    getZoom() { return this.zoom; },
    views: [],
    fitted: null,
    invalidated: 0,
    popupsClosed: 0,
    removed: false,
    setView(center, zoom) { this.views.push({ center, zoom }); },
    fitBounds(points, opts) { this.fitted = { points, opts }; },
    removeLayer(layer) { this.layers.delete(layer); },
    closePopup(popup = this.currentPopup) {
      this.popupsClosed++;
      if (popup && this.currentPopup === popup) {
        this.currentPopup = null;
        emit("popupclose", { popup });
      }
    },
    openPopup(popup) {
      if (this.currentPopup !== popup) this.closePopup(this.currentPopup);
      this.currentPopup = popup;
      emit("popupopen", { popup });
    },
    invalidateSize() { this.invalidated++; },
    remove() { this.removed = true; },
  };
  const L = {
    map: () => map,
    tileLayer: (url, options) => { created.tiles.push({ url, options }); return { addTo() { return this; } }; },
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
        ring, opts, events: {}, closed: 0, unbound: 0, detached: false,
        closePopup() { this.closed++; if (map.currentPopup === this.popupObject) map.closePopup(this.popupObject); },
        openPopup() { map.openPopup(this.popupObject); },
        getPopup() { return this.popupObject; },
        getBounds() { return this.ring; },
        getTooltip() { return this.tooltipObject; },
        setStyle(style) { Object.assign(this.opts, style); },
        on(name, handler) { this.events[name] = handler; return this; },
        unbindPopup() { this.unbound++; },
        unbindTooltip() { this.tooltip = null; this.tooltipObject = null; },
        off() { this.detached = true; this.events = {}; },
        bindPopup(html, options) {
          this.popup = html;
          const element = popupElement();
          this.popupObject = { options, getElement: () => element };
          return this;
        },
        bindTooltip(text, options) {
          this.tooltip = text;
          this.tooltipOptions = options;
          this.tooltipObject = { setLatLng: (point) => { this.labelAt = point; } };
          return this;
        },
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

test("the popup Check off button marks the pin visited; the marker gets a tick", () => {
  authUser.value = { user: "k" };
  trip.value = { id: "bilbao" }; // toggleVisited persists via save(), which needs a trip id
  const { markerGroup } = mount();
  assert.ok(!markerGroup.items[0].opts.icon.spec.html.includes("<path d=\"M9.2"), "unvisited pin has no tick");
  const button = {};
  markerGroup.items[0].events.popupopen(fakePopupContent({ "[data-visit]": button }));
  button.onclick();
  assert.match(pins.value[0].visitedAt, /^\d{4}-\d{2}-\d{2}$/);
  // pins changed → markers re-rendered → the fresh icon carries the tick
  assert.ok(markerGroup.items[0].opts.icon.spec.html.includes("stroke-linejoin"));
  assert.ok(!markerGroup.items[0].opts.icon.spec.html.includes("<circle"));
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


test("effective area replacements preserve the map, pins, stays and visibility", () => {
  const source = signal(definition.neighbourhoods);
  const { L, map, created } = fakeLeaflet();
  const controller = createTripMap({}, definition, L, source);
  const [stayGroup, markerGroup, areaGroup] = created.groups;
  const marker = markerGroup.items[0];
  const stay = stayGroup.items[0];
  const fitted = map.fitted;
  const views = [...map.views];
  const oldPolygon = created.polygons[0];
  areasOn.value = false;
  source.value = [{ ...definition.neighbourhoods[0], name: "Replacement", approximate: true }];
  assert.equal(areaGroup.items.length, 1);
  assert.match(areaGroup.items[0].popup, /Replacement/);
  assert.ok(oldPolygon.closed > 0);
  assert.equal(oldPolygon.unbound, 1);
  assert.equal(oldPolygon.detached, true);
  assert.equal(oldPolygon.tooltip, null);
  assert.equal(markerGroup.items[0], marker);
  assert.equal(stayGroup.items[0], stay);
  assert.equal(map.fitted, fitted);
  assert.deepEqual(map.views, views);
  assert.equal(map.currentPopup, null);
  assert.equal(map.layers.has(areaGroup), false);
  source.value = [];
  assert.equal(areaGroup.items.length, 0);
  areasOn.value = true;
  source.value = definition.neighbourhoods;
  assert.equal(areaGroup.items.length, 1);
  assert.equal(map.layers.has(areaGroup), true);
  controller.destroy();
  source.value = [];
  assert.equal(created.polygons.length, 3);
});

function withTimers(run) {
  const previousSet = globalThis.setTimeout;
  const previousClear = globalThis.clearTimeout;
  const pending = new Map();
  let next = 0;
  globalThis.setTimeout = (callback) => { pending.set(++next, callback); return next; };
  globalThis.clearTimeout = (id) => pending.delete(id);
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback()); };
  try { run({ pending, flush }); }
  finally { globalThis.setTimeout = previousSet; globalThis.clearTimeout = previousClear; }
}

const twoAreas = () => signal([
  { ...definition.neighbourhoods[0], id: "old-town" },
  { ...definition.neighbourhoods[0], id: "second", name: "Second full area", note: "Complete second note" },
]);

function mountAreas(source = twoAreas()) {
  const fake = fakeLeaflet();
  const tripMap = createTripMap({}, definition, fake.L, source);
  return { ...fake, tripMap, source };
}

test("hover shows full information without moving the map and card crossing delays dismissal", () => {
  withTimers(({ pending, flush }) => {
    const { map, created, tripMap } = mountAreas();
    const polygon = created.polygons[1];
    const fitted = map.fitted;
    const views = [...map.views];
    polygon.events.mouseover();
    assert.equal(map.currentPopup, polygon.getPopup());
    assert.equal(polygon.getPopup().options.autoPan, false);
    assert.match(polygon.popup, /Second full area/);
    assert.match(polygon.popup, /Complete second note/);
    assert.equal(polygon.opts.weight, 3);
    assert.equal(map.fitted, fitted);
    assert.deepEqual(map.views, views);
    polygon.events.mouseout();
    assert.equal(pending.size, 1);
    const card = polygon.getPopup().getElement();
    card.handlers.mouseenter();
    flush();
    assert.equal(map.currentPopup, polygon.getPopup());
    card.handlers.mouseleave();
    flush();
    assert.equal(map.currentPopup, null);
    assert.equal(polygon.opts.weight, 1.6);
    assert.deepEqual(card.handlers, {});
    tripMap.destroy();
  });
});

test("click selection survives hover and leave while pin and stay popups prevent area hover", () => {
  withTimers(({ flush }) => {
    const { map, created, tripMap } = mountAreas();
    const [first, second] = created.polygons;
    first.events.click();
    first.events.mouseout();
    second.events.mouseover();
    flush();
    assert.equal(map.currentPopup, first.getPopup());
    second.events.click();
    assert.equal(map.currentPopup, second.getPopup());
    for (const place of [created.markers[0], created.markers[2]]) {
      const placePopup = { place };
      map.openPopup(placePopup);
      first.events.mouseover();
      assert.equal(map.currentPopup, placePopup);
      assert.equal(second.opts.weight, 1.6);
      map.closePopup(placePopup);
      first.events.mouseout();
      first.events.mouseover();
      assert.equal(map.currentPopup, first.getPopup());
    }
    tripMap.destroy();
  });
});

test("Escape and popup dismissal suppress reopening until polygon exit and teardown removes listeners", () => {
  const previousDocument = globalThis.document;
  const events = {};
  globalThis.document = {
    addEventListener(name, handler) { events[name] = handler; },
    removeEventListener(name) { delete events[name]; },
  };
  try {
    const { map, created, tripMap } = mountAreas();
    const polygon = created.polygons[0];
    polygon.events.mouseover();
    events.keydown({ key: "Escape" });
    assert.equal(map.currentPopup, null);
    polygon.events.mouseover();
    assert.equal(map.currentPopup, null);
    polygon.events.mouseout();
    polygon.events.mouseover();
    assert.equal(map.currentPopup, polygon.getPopup());
    map.closePopup();
    polygon.events.mouseover();
    assert.equal(map.currentPopup, null);
    polygon.events.mouseout();
    polygon.events.click();
    assert.equal(map.currentPopup, polygon.getPopup());
    tripMap.destroy();
    assert.deepEqual(events, {});
    assert.deepEqual(polygon.events, {});
  } finally { globalThis.document = previousDocument; }
});

test("showArea enables polygons, fits the selected outline and leaves focus untouched", () => {
  const { map, created, tripMap } = mountAreas();
  areasOn.value = false;
  tripMap.showArea("second");
  assert.equal(areasOn.value, true);
  assert.equal(map.currentPopup, created.polygons[1].getPopup());
  assert.deepEqual(map.fitted, { points: created.polygons[1].ring, opts: { padding: [40, 40], maxZoom: 16 } });
  created.polygons[0].events.mouseover();
  assert.equal(map.currentPopup, created.polygons[1].getPopup());
  const fitted = map.fitted;
  tripMap.showArea("missing");
  assert.equal(map.fitted, fitted);
  areasOn.value = false;
  assert.equal(map.currentPopup, null);
  tripMap.destroy();
});

test("anchored labels follow zoom gates and replacement clears popup, timer and event callbacks", () => {
  withTimers(({ pending, flush }) => {
    const source = signal([{ ...definition.neighbourhoods[0], id: "old", label: "Short", labelAt: [43.255, -2.925], labelMinZoom: 13 }]);
    const { map, created, tripMap } = mountAreas(source);
    const polygon = created.polygons[0];
    assert.equal(polygon.getTooltip(), null);
    map.zoom = 13;
    map.emit("zoomend");
    assert.equal(polygon.tooltip, "Short");
    assert.deepEqual(polygon.labelAt, [43.255, -2.925]);
    polygon.labelAt = [0, 0];
    polygon.events.tooltipopen();
    assert.deepEqual(polygon.labelAt, [43.255, -2.925]);
    assert.equal(polygon.tooltipOptions.interactive, false);
    map.zoom = 12;
    map.emit("zoomend");
    assert.equal(polygon.getTooltip(), null);
    polygon.events.mouseover();
    const card = polygon.getPopup().getElement();
    polygon.events.mouseout();
    assert.equal(pending.size, 1);
    source.value = [];
    assert.equal(pending.size, 0);
    assert.equal(map.currentPopup, null);
    assert.deepEqual(card.handlers, {});
    assert.deepEqual(polygon.events, {});
    flush();
    tripMap.destroy();
    map.zoom = 14;
    map.emit("zoomend");
    assert.equal(polygon.getTooltip(), null);
  });
});

test("basemap uses public OSM without a key and preserves keyed CARTO", () => {
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { ENV: {} };
    const fallback = mountAreas();
    assert.equal(fallback.created.tiles[0].url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    assert.match(fallback.created.tiles[0].options.attribution, /openstreetmap.org\/copyright/);
    fallback.tripMap.destroy();
    globalThis.window = { ENV: { cartoApiKey: "key & test" } };
    const keyed = mountAreas();
    assert.match(keyed.created.tiles[0].url, /cartocdn.com/);
    assert.match(keyed.created.tiles[0].url, /key=key%20%26%20test/);
    keyed.tripMap.destroy();
  } finally { globalThis.window = previousWindow; }
});

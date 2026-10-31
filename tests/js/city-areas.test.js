import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAreas, parseAreaFile, serializeAreas } from '../../web/lib/areas.js';

const cities = {
  bilbao: {
    ids: ['indautxu-ensanche', 'bilbao-la-vieja', 'deusto', 'casco-viejo', 'pozas-san-mames', 'guggenheim-abandoibarra'],
    bounds: [43.24, 43.29, -2.98, -2.90],
    landmarks: {
      'indautxu-ensanche': [43.2597198, -2.9371747],
      'bilbao-la-vieja': [43.252861, -2.923079],
      'deusto': [43.2724195, -2.9456119],
      'pozas-san-mames': [43.264204, -2.9493915],
      'casco-viejo': [43.2593788, -2.9222899],
      'guggenheim-abandoibarra': [43.2686712, -2.9340118],
    },
  },
  oviedo: {
    ids: ['ruta-de-los-vinos', 'ensanche-west', 'centro-uria-campoamor', 'gascona-foncalada', 'cathedral-old-town', 'fontan-trascorrales'],
    bounds: [43.35, 43.375, -5.865, -5.83],
    landmarks: {
      'ruta-de-los-vinos': [43.366441, -5.852168],
      'ensanche-west': [43.364738, -5.853926],
      'centro-uria-campoamor': [43.362041, -5.845841],
      'gascona-foncalada': [43.364112, -5.843995],
      'cathedral-old-town': [43.361728, -5.842453],
      'fontan-trascorrales': [43.359387, -5.843116],
    },
  },
};

for (const [city, { ids, bounds, landmarks }] of Object.entries(cities)) {
  const trip = JSON.parse(readFileSync(new URL(`../../web/trips/${city}.json`, import.meta.url), 'utf8'));
  const areas = trip.neighbourhoods;
  test(`${city} travel areas have complete ratings and survive file round trips`, () => {
    assert.deepEqual(areas.map(area => area.id).sort(), [...ids].sort());
    const validated = validateAreas(areas);
    assert.deepEqual(validated.errors, []);
    assert.deepEqual(validated.areas, areas);
    assert.deepEqual(parseAreaFile(serializeAreas(city, areas), city).document.areas, areas);
    for (const area of areas) {
      assert.equal(area.approximate, true);
      assert.deepEqual(Object.keys(area.ratings).sort(), ['foodDrink', 'ourKindOfPlace', 'touristiness']);
      assert.ok(area.note.length > 80 && area.note.length <= 600, area.id);
      assert.ok(area.label.length <= area.name.length, area.id);
      assert.ok(area.labelMinZoom >= 13 && area.labelMinZoom <= 16, area.id);
      for (const [lat, lng] of [...area.ring, area.labelAt]) {
        assert.ok(lat >= bounds[0] && lat <= bounds[1] && lng >= bounds[2] && lng <= bounds[3], area.id);
      }
    }
  });
  test(`${city} landmark locations remain inside the intended travel area`, () => {
    for (const [id, point] of Object.entries(landmarks)) {
      assert.ok(strictlyInside(areas.find(area => area.id === id).ring, point), id);
      assert.ok(!areas.some(area => area.id !== id && strictlyInside(area.ring, point)), `${id} overlaps another area`);
    }
  });
  test(`${city} travel area interiors remain separately selectable`, () => {
    for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i], b = areas[j];
      assert.ok(!a.ring.some(point => strictlyInside(b.ring, point)), `${a.id} enters ${b.id}`);
      assert.ok(!b.ring.some(point => strictlyInside(a.ring, point)), `${b.id} enters ${a.id}`);
      for (let k = 0; k < a.ring.length; k++) for (let l = 0; l < b.ring.length; l++) {
        const p = a.ring[k], q = a.ring[(k + 1) % a.ring.length];
        const r = b.ring[l], s = b.ring[(l + 1) % b.ring.length];
        assert.ok(!(cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0), `${a.id} crosses ${b.id}`);
      }
    }
  });
}

function strictlyInside(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (Math.abs(cross) < 1e-14 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) &&
        point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1])) return false;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}


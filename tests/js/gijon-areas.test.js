import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAreas, parseAreaFile, serializeAreas } from '../../web/lib/areas.js';

const trip = JSON.parse(readFileSync(new URL('../../web/trips/gijon.json', import.meta.url), 'utf8'));
const expected = [
  ['la-arena', 'La Arena', 'high', /residential/i, /beach/i, /coffee/i, /chigres/i],
  ['cimavilla', 'Cimavilla', 'very high', /old fishing quarter/i, /cider/i, /chigres/i, /tourists/i],
  ['centro-el-carmen', 'Centro / El Carmen', 'very high', /dense/i, /wine/i, /vermouth/i, /coffee/i],
  ['marina-el-muelle', 'Marina / El Muelle', 'medium', /waterfront walk/i, /visitor-oriented/i, /selectively/i],
  ['fomento', 'Fomento', 'lower', /late-night bars/i],
  ['el-llano', 'El Llano', 'medium', /everyday residential/i, /local character/i],
  ['poniente-natahoyo-west', 'Poniente / Natahoyo / west', 'low', /industrial/i, /residential west/i],
  ['somio-east', 'Somió / east', 'low', /leafy villas/i, /destination dining/i],
];

test('Gijón has all eight approximate travel areas with stable IDs and complete preferences', () => {
  assert.equal(trip.neighbourhoods.length, expected.length);
  trip.neighbourhoods.forEach((area, index) => {
    const [id, name, fit, ...meanings] = expected[index];
    assert.equal(area.id, id);
    assert.equal(area.name, name);
    assert.equal(area.approximate, true);
    assert.ok(area.note.includes(`Fit for this trip: ${fit}.`));
    meanings.forEach(meaning => assert.match(area.note, meaning));
  });
  assert.equal(new Set(trip.neighbourhoods.map(area => area.color)).size, 8);
});

test('authored seeds obey the shared contract and round-trip through the public format', () => {
  const validated = validateAreas(trip.neighbourhoods);
  assert.deepEqual(validated.errors, []);
  assert.deepEqual(validated.areas, trip.neighbourhoods);
  const parsed = parseAreaFile(serializeAreas('gijon', validated.areas), 'gijon');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.document.areas, trip.neighbourhoods);
});

test('outlines and label anchors remain local to Gijón and dense zones have gated short labels', () => {
  for (const area of trip.neighbourhoods) {
    for (const [lat, lng] of [...area.ring, area.labelAt]) {
      assert.ok(lat >= 43.52 && lat <= 43.56, `${area.id}: latitude ${lat}`);
      assert.ok(lng >= -5.71 && lng <= -5.60, `${area.id}: longitude ${lng}`);
    }
    assert.ok(area.label.length <= area.name.length);
    assert.ok(Number.isInteger(area.labelMinZoom));
  }
  for (const id of ['centro-el-carmen', 'marina-el-muelle', 'fomento']) {
    const area = trip.neighbourhoods.find(area => area.id === id);
    assert.ok(area.labelMinZoom >= 14);
  }
});

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

test('travel area interiors do not overlap and central waterfront zones remain distinct', () => {
  const areas = trip.neighbourhoods;
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i], b = areas[j];
      assert.ok(!a.ring.some(point => strictlyInside(b.ring, point)), `${a.id} enters ${b.id}`);
      assert.ok(!b.ring.some(point => strictlyInside(a.ring, point)), `${b.id} enters ${a.id}`);
      for (let k = 0; k < a.ring.length; k++) {
        const p = a.ring[k], q = a.ring[(k + 1) % a.ring.length];
        for (let l = 0; l < b.ring.length; l++) {
          const r = b.ring[l], s = b.ring[(l + 1) % b.ring.length];
          assert.ok(!(cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0), `${a.id} crosses ${b.id}`);
        }
      }
    }
  }
  assert.ok(areas.find(area => area.id === 'marina-el-muelle').labelAt[0] > areas.find(area => area.id === 'centro-el-carmen').labelAt[0]);
  assert.ok(areas.find(area => area.id === 'fomento').labelAt[1] < areas.find(area => area.id === 'marina-el-muelle').labelAt[1]);
});

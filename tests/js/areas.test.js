import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAreas, adaptSeeds, parseAreaFile, serializeAreas, planReplacement, MAX_AREA_FILE_BYTES } from '../../web/lib/areas.js';

const area = (changes = {}) => ({ id: 'centre', name: 'Centre', note: 'A note.', color: '#c26b3d', approximate: true,
  ring: [[43, -5], [43, -4], [44, -4], [44, -5]], ...changes });
const document = (areas, changes = {}) => ({ type: 'trips-areas', version: 1, tripId: 'gijon', areas, ...changes });
const codes = result => result.errors.map(error => error.code);

test('round trips preserve array order and plain text, normalize closure, and copy geometry', () => {
  const first = area({ note: '<script>plain text</script>', label: 'Short', labelAt: [43.5, -4.5], labelMinZoom: 13 });
  first.ring.push([...first.ring[0]]);
  const second = area({ id: 'other' });
  const parsed = parseAreaFile(serializeAreas('gijon', [second, first]), 'gijon');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.document.areas.map(a => a.id), ['other', 'centre']);
  assert.equal(parsed.document.areas[1].ring.length, 4);
  assert.equal(parsed.document.areas[1].note, first.note);
  const normalized = validateAreas([first]).areas[0];
  normalized.ring[0][0] = 0;
  normalized.labelAt[0] = 0;
  assert.equal(first.ring[0][0], 43);
  assert.equal(first.labelAt[0], 43.5);
  assert.deepEqual(parseAreaFile(serializeAreas('gijon', []), 'gijon').document.areas, []);
});

test('envelope rejects unknown, missing, wrongly typed, unsupported and wrong-trip values', () => {
  for (const [changes, code] of [[{ extra: 1 }, 'unknown-field'], [{ version: '1' }, 'version'],
    [{ version: 2 }, 'version'], [{ type: 'FeatureCollection' }, 'document-type'],
    [{ tripId: 'bilbao' }, 'wrong-trip'], [{ tripId: 1 }, 'trip-id'], [{ areas: null }, 'type']]) {
    const result = parseAreaFile(JSON.stringify(document([], changes)), 'gijon');
    assert.equal(result.document, null);
    assert.ok(codes(result).includes(code));
  }
  const missing = document([]);
  delete missing.version;
  assert.ok(codes(parseAreaFile(JSON.stringify(missing), 'gijon')).includes('required'));
  for (const text of ['null', '[]', '{', '']) assert.equal(parseAreaFile(text, 'gijon').document, null);
});

test('entry rules reject coercion, duplicates, unknown fields and invalid text', () => {
  const failures = [{ id: 'CAPS' }, { id: '' }, { id: 'a'.repeat(65) }, { name: '  ' },
    { name: 'x'.repeat(121) }, { note: 'x'.repeat(4001) }, { note: null }, { color: 'red' },
    { color: '#abc' }, { approximate: 1 }, { label: '' }, { label: null },
    { labelMinZoom: 1.5 }, { labelMinZoom: -1 }, { labelMinZoom: 20 }, { labelMinZoom: '13' }, { extra: true }];
  for (const changes of failures) {
    const result = validateAreas([area(changes)]);
    assert.equal(result.areas, null, JSON.stringify(changes));
    assert.ok(result.errors.length);
    result.errors.forEach(error => assert.deepEqual(Object.keys(error), ['path', 'code', 'message']));
  }
  const missing = area();
  delete missing.note;
  assert.ok(codes(validateAreas([missing])).includes('required'));
  assert.ok(codes(validateAreas([area(), area()])).includes('duplicate-id'));
  assert.equal(validateAreas([null]).areas, null);
  assert.equal(validateAreas([area({ color: '#ABCDEF', note: '', labelMinZoom: 0 })]).errors.length, 0);
});

test('rings reject duplicate vertices, crossings, touches, retraced edges and zero area', () => {
  const invalidRings = [
    [[0, 0], [0, 1]],
    [[0, 0], [0, 1], [1, 1], [0, 1], [1, 0]],
    [[0, 0], [1, 1], [0, 1], [1, 0]],
    [[0, 0], [0, 3], [1, 3], [0, 1], [1, 0]],
    [[0, 0], [0, 3], [0, 1], [1, 0]],
    [[0, 0], [0, 1], [0, 2]],
    [[[0, 0], [0, 1], [1, 1]]],
  ];
  for (const ring of invalidRings) assert.equal(validateAreas([area({ ring })]).areas, null, JSON.stringify(ring));
  assert.ok(codes(validateAreas([area({ ring: invalidRings[1] })])).includes('duplicate-vertex'));
  assert.ok(codes(validateAreas([area({ ring: invalidRings[2] })])).includes('self-intersection'));
  assert.ok(codes(validateAreas([area({ ring: invalidRings[5] })])).includes('zero-area'));
});

test('valid concave polygons, straight boundary vertices, small polygons and reversed rings pass', () => {
  const ring = [[0, 0], [0, 1], [0, 2], [2, 2], [1, 1], [2, 0]];
  for (const candidate of [ring, [...ring].reverse(), [[43, -5], [43 + 1e-9, -5], [43, -5 + 1e-9]]]) {
    assert.deepEqual(validateAreas([area({ ring: candidate })]).errors, []);
  }
});

test('coordinates, antimeridian edges and label anchors obey local polygon limits', () => {
  for (const point of [[NaN, 0], [Infinity, 0], ['43', -5], [86, 0], [0, 181], [0], [0, 0, 0]]) {
    const result = validateAreas([area({ ring: [point, [1, 0], [0, 1]] })]);
    assert.equal(result.areas, null);
    assert.equal(result.errors[0].path, 'areas[0].ring[0]');
  }
  assert.ok(codes(validateAreas([area({ ring: [[0, 179], [1, -179], [0, -178]] })])).includes('antimeridian'));
  for (const labelAt of [[43.5, -4.5], [43, -4.5], [43, -5]]) assert.deepEqual(validateAreas([area({ labelAt })]).errors, []);
  assert.ok(codes(validateAreas([area({ labelAt: [45, -5] })])).includes('anchor-outside'));
  assert.equal(validateAreas([area({ labelAt: [NaN, 0] })]).areas, null);
  const concave = [[0, 0], [0, 2], [2, 2], [1, 1], [2, 0]];
  assert.ok(codes(validateAreas([area({ ring: concave, labelAt: [1.75, 1] })])).includes('anchor-outside'));
});

test('file, area and vertex counts enforce limits including UTF-8 bytes', () => {
  const text = JSON.stringify(document([]));
  assert.deepEqual(parseAreaFile(text.padEnd(MAX_AREA_FILE_BYTES, ' '), 'gijon').errors, []);
  assert.ok(codes(parseAreaFile(text.padEnd(MAX_AREA_FILE_BYTES + 1, ' '), 'gijon')).includes('file-size'));
  assert.ok(codes(parseAreaFile('é'.repeat(MAX_AREA_FILE_BYTES / 2 + 1), 'gijon')).includes('file-size'));
  assert.equal(validateAreas(Array.from({ length: 100 }, (_, i) => area({ id: `area-${i}` }))).errors.length, 0);
  assert.ok(codes(validateAreas(Array.from({ length: 101 }, (_, i) => area({ id: `area-${i}` })))).includes('area-count'));
  const circle = count => Array.from({ length: count }, (_, i) => [Math.sin(i * 2 * Math.PI / count), Math.cos(i * 2 * Math.PI / count)]);
  const ring = circle(500);
  assert.deepEqual(validateAreas([area({ ring: [...ring, ring[0]] })]).errors, []);
  assert.ok(codes(validateAreas([area({ ring: circle(501) })])).includes('vertex-count'));
  assert.throws(() => serializeAreas('gijon', Array.from({ length: 100 }, (_, i) => area({ id: `area-${i}`, note: 'é'.repeat(4000) }))), error => error.errors[0].code === 'file-size');
});

test('seed adaptation gives deterministic legacy IDs and retains explicit fields', () => {
  const legacy = area();
  delete legacy.id;
  delete legacy.approximate;
  const seeds = [legacy, area({ id: 'explicit', approximate: true })];
  const adapted = adaptSeeds(seeds);
  assert.deepEqual(adapted.map(({ id, approximate }) => ({ id, approximate })), [
    { id: 'seed-0', approximate: false }, { id: 'explicit', approximate: true },
  ]);
  assert.equal(legacy.id, undefined);
  assert.deepEqual(adaptSeeds(), []);
  const bilbao = JSON.parse(readFileSync(new URL('../../web/trips/bilbao.json', import.meta.url), 'utf8'));
  assert.equal(adaptSeeds(bilbao.neighbourhoods).length, bilbao.neighbourhoods.length);
  assert.throws(() => adaptSeeds([area({ approximate: null })]), error => error.errors.length > 0);
});

test('replacement compares normalized complete fields by ID with deterministic ordering', () => {
  const current = [area({ id: 'removed' }), area({ id: 'changed' }), area({ id: 'same' })];
  const same = area({ id: 'same' });
  same.ring.push([...same.ring[0]]);
  const result = planReplacement('gijon', current, document([same, area({ id: 'added' }), area({ id: 'changed', note: 'New.' })]));
  assert.deepEqual(result.added, ['added']);
  assert.deepEqual(result.changed, ['changed']);
  assert.deepEqual(result.removed, ['removed']);
  assert.deepEqual(result.areas.map(a => a.id), ['same', 'added', 'changed']);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(planReplacement('gijon', result.areas, document(result.areas)).changed, []);
  assert.deepEqual(planReplacement('gijon', current, document([])).removed, ['removed', 'changed', 'same']);
  const rejected = planReplacement('gijon', current, document([area()], { tripId: 'bilbao' }));
  assert.equal(rejected.areas, null);
  assert.deepEqual(rejected.added, []);
  assert.ok(codes(rejected).includes('wrong-trip'));
  assert.throws(() => serializeAreas('Bad Trip', []), error => error.errors[0].path === 'tripId');
});

test('serialization falls back to compact JSON for a valid large import', () => {
  const areas = Array.from({ length: 62 }, (_, index) => ({
    id: `area-${index}`, name: 'Area', note: 'x'.repeat(4000), color: '#abcdef',
    approximate: true, ring: [[1,1],[1,2],[2,2]],
  }));
  const text = serializeAreas('demo', areas);
  assert.ok(new TextEncoder().encode(text).length <= MAX_AREA_FILE_BYTES);
  assert.equal(parseAreaFile(text, 'demo').document.areas.length, 62);
});

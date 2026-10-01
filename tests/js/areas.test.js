import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAreas, adaptSeeds, parseAreaFile, serializeAreas, planReplacement, MAX_AREA_FILE_BYTES } from '../../web/lib/areas.js';
import { AREA_RATINGS, areaRatingRows } from '../../web/lib/area-ratings.js';

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

test('ratings are optional, partial, detached and canonical across round trips and replacements', () => {
  const legacy = validateAreas([area()]).areas[0];
  assert.equal(Object.hasOwn(legacy, 'ratings'), false);
  assert.deepEqual(validateAreas([area({ ratings: {} })]).areas[0].ratings, {});
  assert.deepEqual(validateAreas([area({ ratings: { foodDrink: 1 } })]).areas[0].ratings, { foodDrink: 1 });
  const input = area({ ratings: { ourKindOfPlace: 5, foodDrink: 4, touristiness: 1 } });
  const normalized = validateAreas([input]).areas[0];
  assert.deepEqual(Object.keys(normalized.ratings), ['touristiness', 'foodDrink', 'ourKindOfPlace']);
  normalized.ratings.touristiness = 2;
  assert.equal(input.ratings.touristiness, 1);
  const parsed = parseAreaFile(serializeAreas('gijon', [input]), 'gijon');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.document.areas[0].ratings, input.ratings);
  assert.deepEqual(adaptSeeds([input])[0].ratings, input.ratings);
  assert.deepEqual(planReplacement('gijon', [input], parsed.document).changed, []);
  const changed = planReplacement('gijon', [input], document([area({ ratings: { touristiness: 2, foodDrink: 4, ourKindOfPlace: 5 } })]));
  assert.deepEqual(changed.changed, ['centre']);
  assert.deepEqual(planReplacement('gijon', [input], document([area()])).changed, ['centre']);
});

test('ratings reject unknown fields, nonobjects and values outside integer 1–5 without coercion', () => {
  for (const ratings of [null, [], '5', true, 5]) {
    const result = validateAreas([area({ ratings })]);
    assert.equal(result.areas, null);
    assert.ok(result.errors.some(error => error.path === 'areas[0].ratings' && error.code === 'type'));
  }
  const unknown = validateAreas([area({ ratings: { foodDrink: 5, score: 3 } })]);
  assert.equal(unknown.areas, null);
  assert.ok(unknown.errors.some(error => error.path === 'areas[0].ratings.score' && error.code === 'unknown-field'));
  for (const { key } of AREA_RATINGS) {
    for (const value of [0, 6, -1, 2.5, '3', true, null, undefined, NaN, Infinity, {}, []]) {
      const result = validateAreas([area({ ratings: { [key]: value } })]);
      assert.equal(result.areas, null, `${key}: ${String(value)}`);
      assert.ok(result.errors.some(error => error.path === `areas[0].ratings.${key}` && error.code === 'rating'));
    }
  }
  const invalidFile = parseAreaFile(JSON.stringify(document([area({ ratings: { foodDrink: '5' } })])), 'gijon');
  assert.equal(invalidFile.document, null);
  assert.throws(() => serializeAreas('gijon', [area({ ratings: { foodDrink: 0 } })]), error => error.errors.some(error => error.code === 'rating'));
});

test('rating rows share labels and emoji and never invent absent or malformed scores', () => {
  assert.deepEqual(AREA_RATINGS, [
    { key: 'touristiness', label: 'Touristiness', emoji: '📷' },
    { key: 'foodDrink', label: 'Food & drink interest', emoji: '🍷' },
    { key: 'ourKindOfPlace', label: 'Our kind of place', emoji: '❤️' },
  ]);
  assert.deepEqual(areaRatingRows(area({ ratings: { foodDrink: 5, touristiness: 2, ourKindOfPlace: 4 } })),
    AREA_RATINGS.map((metadata, index) => ({ ...metadata, value: [2, 5, 4][index] })));
  for (const input of [null, undefined, area(), area({ ratings: {} }), area({ ratings: null }), area({ ratings: [] }), area({ ratings: '3' })]) {
    assert.deepEqual(areaRatingRows(input), []);
  }
  assert.deepEqual(areaRatingRows(area({ ratings: { touristiness: '2', foodDrink: 3, ourKindOfPlace: 6, extra: 5 } })),
    [{ key: 'foodDrink', label: 'Food & drink interest', emoji: '🍷', value: 3 }]);
  assert.deepEqual(areaRatingRows(area({ ratings: Object.create({ touristiness: 4 }) })), []);
});

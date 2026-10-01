export const MAX_AREA_FILE_BYTES = 256 * 1024;
export const MAX_AREAS = 100;

const REQUIRED = ['id', 'name', 'note', 'color', 'approximate', 'ring'];
const OPTIONAL = ['label', 'labelAt', 'labelMinZoom'];
const LATITUDE_LIMIT = 85.05112878;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const error = (errors, path, code, message) => errors.push({ path, code, message });

function coordinate(value, path, errors) {
  if (!Array.isArray(value) || value.length !== 2 ||
      !value.every(v => typeof v === 'number' && Number.isFinite(v))) {
    error(errors, path, 'coordinate', 'Use two finite numbers in [latitude, longitude] order.');
    return false;
  }
  if (Math.abs(value[0]) > LATITUDE_LIMIT || Math.abs(value[1]) > 180) {
    error(errors, path, 'coordinate-range', 'Coordinates exceed the supported latitude or longitude range.');
    return false;
  }
  return true;
}

function orientation(a, b, c) {
  const first = (b[0] - a[0]) * (c[1] - a[1]);
  const second = (b[1] - a[1]) * (c[0] - a[0]);
  const cross = first - second;
  const tolerance = Number.EPSILON * 8 * (Math.abs(first) + Math.abs(second));
  return Math.abs(cross) <= tolerance ? 0 : Math.sign(cross);
}

function onSegment(a, b, point) {
  return orientation(a, b, point) === 0 &&
    point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) &&
    point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
}

function intersects(a, b, c, d) {
  const abc = orientation(a, b, c), abd = orientation(a, b, d);
  const cda = orientation(c, d, a), cdb = orientation(c, d, b);
  return (abc * abd < 0 && cda * cdb < 0) ||
    (abc === 0 && onSegment(a, b, c)) || (abd === 0 && onSegment(a, b, d)) ||
    (cda === 0 && onSegment(c, d, a)) || (cdb === 0 && onSegment(c, d, b));
}

function contains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSegment(a, b, point)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function validateRing(value, path, errors) {
  if (!Array.isArray(value)) {
    error(errors, path, 'type', 'The ring must be an array of coordinates.');
    return null;
  }
  if (value.length > 501) {
    error(errors, path, 'vertex-count', 'Use 3–500 distinct vertices, with an optional closing vertex.');
    return null;
  }
  let valid = true;
  value.forEach((point, index) => { if (!coordinate(point, `${path}[${index}]`, errors)) valid = false; });
  if (!valid) return null;
  const ring = value.map(point => [...point]);
  if (ring.length > 1 && samePoint(ring[0], ring.at(-1))) ring.pop();
  if (ring.length < 3 || ring.length > 500) {
    error(errors, path, 'vertex-count', 'Use 3–500 distinct vertices.');
    return null;
  }
  const seen = new Set();
  ring.forEach((point, index) => {
    const key = JSON.stringify(point);
    if (seen.has(key)) { error(errors, `${path}[${index}]`, 'duplicate-vertex', 'Only the optional closing vertex may repeat.'); valid = false; }
    seen.add(key);
  });
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.abs(a[1] - b[1]) > 180) {
      error(errors, `${path}[${i}]`, 'antimeridian', 'Edges must not cross the antimeridian.'); valid = false;
    }
    const c = ring[(i + 2) % ring.length];
    if (orientation(a, b, c) === 0 && (onSegment(a, b, c) || onSegment(b, c, a))) {
      error(errors, `${path}[${(i + 1) % ring.length}]`, 'self-intersection', 'Adjacent edges must not overlap.'); valid = false;
    }
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) {
        error(errors, `${path}[${i}]`, 'self-intersection', `Edge intersects the edge at vertex ${j}.`); valid = false;
      }
    }
  }
  const origin = ring[0];
  let twiceArea = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    twiceArea += (ring[i][0] - origin[0]) * (ring[i + 1][1] - origin[1]) -
      (ring[i][1] - origin[1]) * (ring[i + 1][0] - origin[0]);
  }
  if (twiceArea === 0) { error(errors, path, 'zero-area', 'The polygon must have nonzero area.'); valid = false; }
  return valid ? ring : null;
}

export function validateAreas(value) {
  const errors = [];
  if (!Array.isArray(value)) return { areas: null, errors: [{ path: 'areas', code: 'type', message: 'Areas must be an array.' }] };
  if (value.length > MAX_AREAS) return { areas: null, errors: [{ path: 'areas', code: 'area-count', message: 'Use at most 100 areas.' }] };
  const ids = new Set();
  const areas = value.map((entry, index) => {
    const path = `areas[${index}]`;
    if (!object(entry)) { error(errors, path, 'type', 'Each area must be an object.'); return null; }
    for (const key of Object.keys(entry)) if (![...REQUIRED, ...OPTIONAL].includes(key)) error(errors, `${path}.${key}`, 'unknown-field', 'Unknown area field.');
    for (const key of REQUIRED) if (!own(entry, key)) error(errors, `${path}.${key}`, 'required', 'This field is required.');
    if (typeof entry.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(entry.id)) error(errors, `${path}.id`, 'id', 'IDs use 1–64 lowercase letters, digits or hyphens.');
    else { if (ids.has(entry.id)) error(errors, `${path}.id`, 'duplicate-id', 'Area IDs must be unique.'); ids.add(entry.id); }
    for (const key of ['name', 'label']) {
      if (key === 'label' && !own(entry, key)) continue;
      if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 120) error(errors, `${path}.${key}`, 'text', 'Use a nonblank string of at most 120 characters.');
    }
    if (typeof entry.note !== 'string' || entry.note.length > 4000) error(errors, `${path}.note`, 'text', 'Notes must be plain text of at most 4,000 characters.');
    if (typeof entry.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(entry.color)) error(errors, `${path}.color`, 'color', 'Use a six-digit hexadecimal colour such as #c26b3d.');
    if (typeof entry.approximate !== 'boolean') error(errors, `${path}.approximate`, 'type', 'Approximate must be a boolean.');
    const ring = validateRing(entry.ring, `${path}.ring`, errors);
    if (own(entry, 'labelAt') && coordinate(entry.labelAt, `${path}.labelAt`, errors) && ring && !contains(ring, entry.labelAt)) error(errors, `${path}.labelAt`, 'anchor-outside', 'The label anchor must lie within the polygon.');
    if (own(entry, 'labelMinZoom') && (!Number.isInteger(entry.labelMinZoom) || entry.labelMinZoom < 0 || entry.labelMinZoom > 19)) error(errors, `${path}.labelMinZoom`, 'zoom', 'Label zoom must be an integer from 0 to 19.');
    const normalized = {};
    for (const key of [...REQUIRED, ...OPTIONAL]) if (own(entry, key)) normalized[key] = key === 'ring' ? ring : key === 'labelAt' ? [...(Array.isArray(entry[key]) ? entry[key] : [])] : entry[key];
    return normalized;
  });
  return { areas: errors.length ? null : areas, errors };
}

export function adaptSeeds(seeds = []) {
  const candidates = Array.isArray(seeds) ? seeds.map((seed, index) => object(seed) ? {
    ...seed, id: own(seed, 'id') ? seed.id : `seed-${index}`,
    approximate: own(seed, 'approximate') ? seed.approximate : false,
  } : seed) : seeds;
  const result = validateAreas(candidates);
  if (result.errors.length) throw invalid(result.errors);
  return result.areas;
}

function validateDocument(value, tripId) {
  const errors = [];
  if (!object(value)) return { document: null, errors: [{ path: '', code: 'type', message: 'The area file must contain an object.' }] };
  for (const key of Object.keys(value)) if (!['type', 'version', 'tripId', 'areas'].includes(key)) error(errors, key, 'unknown-field', 'Unknown document field.');
  for (const key of ['type', 'version', 'tripId', 'areas']) if (!own(value, key)) error(errors, key, 'required', 'This field is required.');
  if (value.type !== 'trips-areas') error(errors, 'type', 'document-type', 'Expected a trips-areas document.');
  if (value.version !== 1) error(errors, 'version', 'version', 'Only area file version 1 is supported.');
  if (typeof value.tripId !== 'string' || !/^[a-z0-9-]+$/.test(value.tripId)) error(errors, 'tripId', 'trip-id', 'Use a valid trip ID.');
  else if (value.tripId !== tripId) error(errors, 'tripId', 'wrong-trip', `This file belongs to ${value.tripId}, not ${tripId}.`);
  const validated = validateAreas(value.areas);
  errors.push(...validated.errors);
  return { document: errors.length ? null : { type: 'trips-areas', version: 1, tripId: value.tripId, areas: validated.areas }, errors };
}

export function parseAreaFile(text, tripId) {
  if (typeof text !== 'string') return { document: null, errors: [{ path: '', code: 'type', message: 'Area file contents must be text.' }] };
  if (new TextEncoder().encode(text).length > MAX_AREA_FILE_BYTES) return { document: null, errors: [{ path: '', code: 'file-size', message: 'Area files must be at most 256 KiB UTF-8.' }] };
  let value;
  try { value = JSON.parse(text); } catch { return { document: null, errors: [{ path: '', code: 'json', message: 'The file is not valid JSON.' }] }; }
  return validateDocument(value, tripId);
}

function invalid(errors) {
  const failure = new Error(errors[0].message);
  failure.errors = errors;
  return failure;
}

export function serializeAreas(tripId, areas) {
  const validated = validateDocument({ type: 'trips-areas', version: 1, tripId, areas }, tripId);
  if (validated.errors.length) throw invalid(validated.errors);
  let text = JSON.stringify(validated.document, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > MAX_AREA_FILE_BYTES) text = JSON.stringify(validated.document);
  if (new TextEncoder().encode(text).length > MAX_AREA_FILE_BYTES) throw invalid([{ path: '', code: 'file-size', message: 'Area files must be at most 256 KiB UTF-8.' }]);
  return text;
}

export function planReplacement(tripId, current, incomingDocument) {
  const incoming = validateDocument(incomingDocument, tripId);
  const previous = validateAreas(current);
  const errors = [...incoming.errors, ...previous.errors];
  if (errors.length) return { areas: null, added: [], changed: [], removed: [], errors };
  const oldById = new Map(previous.areas.map(area => [area.id, area]));
  const newIds = new Set(incoming.document.areas.map(area => area.id));
  const added = [], changed = [];
  for (const area of incoming.document.areas) {
    if (!oldById.has(area.id)) added.push(area.id);
    else if (JSON.stringify(oldById.get(area.id)) !== JSON.stringify(area)) changed.push(area.id);
  }
  return { areas: incoming.document.areas, added, changed,
    removed: previous.areas.filter(area => !newIds.has(area.id)).map(area => area.id), errors: [] };
}

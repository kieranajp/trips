import { areaErrors, areaOverride, effectiveAreas, trip } from "./signals.js";
import { canEdit } from "./auth.js";
import { adaptSeeds, parseAreaFile, planReplacement } from "../lib/areas.js";
import { commitCandidate, snapshot } from "./persistence.js";

const error = (code, message) => ({ errors: [{ path: "areas", code, message }] });
const fingerprint = () => JSON.stringify({ override: areaOverride.value, areas: effectiveAreas.value });
function preview(document, restore = false) {
  const result = planReplacement(trip.value.id, effectiveAreas.value, document);
  if (result.errors.length) return result;
  return { errors: [], preview: {
    tripId: trip.value.id, before: effectiveAreas.value,
    areas: result.areas, override: restore ? null : result.areas,
    added: result.added, changed: result.changed, removed: result.removed,
    fingerprint: fingerprint(),
  } };
}
export function previewAreas(text) {
  if (!canEdit.value) return error("permission", "Sign in to import areas.");
  const parsed = parseAreaFile(text, trip.value.id);
  return parsed.errors.length ? parsed : preview(parsed.document);
}
export function previewRestore() {
  if (!canEdit.value) return error("permission", "Sign in to restore areas.");
  return preview({ type: "trips-areas", version: 1, tripId: trip.value.id,
    areas: adaptSeeds(trip.value.neighbourhoods || []) }, true);
}
export function applyAreas(candidate) {
  if (!canEdit.value) return error("permission", "Sign in before applying areas.");
  if (candidate.tripId !== trip.value.id) return error("trip", "The trip changed. Import the file again.");
  if (candidate.fingerprint !== fingerprint()) {
    const refreshed = candidate.override === null ? previewRestore() : preview({
      type: "trips-areas", version: 1, tripId: candidate.tripId, areas: candidate.areas,
    });
    return { ...refreshed, ...error("stale", "Areas changed. Review the updated comparison and apply again.") };
  }
  try {
    const state = commitCandidate({ ...snapshot(), areaOverride: candidate.override });
    areaOverride.value = state.areaOverride;
    areaErrors.value = [];
    return { errors: [] };
  } catch (cause) {
    return error("storage", `Areas were not applied: ${cause.message}`);
  }
}

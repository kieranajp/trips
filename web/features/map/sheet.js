import { resizeMap } from "./leaflet.js";

// Mobile bottom-sheet drag. On phones the sidebar stops being a fixed split and
// becomes a sheet the user drags up (toward full screen) or down (to give the
// map room). Purely imperative DOM gestures on the handle — same "outside the
// Preact tree" approach as Leaflet, so pointer moves don't churn the component
// tree. No-op on desktop, where `.side` is a normal fixed-width sidebar.

const KEY = "trips_sheet_frac";
const SNAPS = [0.3, 0.58, 0.92]; // fractions of the map view height
const DEFAULT = SNAPS[1];
const MOBILE = "(max-width: 720px)";

export function initSheet(view, side, handle) {
  const mq = window.matchMedia(MOBILE);
  let dragging = false;
  let startY = 0;
  let startH = 0;
  let raf = 0;

  const total = () => view.clientHeight || window.innerHeight;
  // Same guard as state/persistence.js: some privacy modes throw on any
  // localStorage access, and sync() runs on every viewport change.
  const savedFrac = () => {
    try { return parseFloat(localStorage.getItem(KEY)); } catch { return NaN; }
  };
  const clampPx = (px) => {
    const t = total();
    return Math.max(t * 0.12, Math.min(t * 0.94, px));
  };
  const setFrac = (frac) => { side.style.height = frac * total() + "px"; };

  // Repaint the map at most once per frame while dragging so tiles keep up.
  const scheduleResize = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; resizeMap(); });
  };

  const onDown = (event) => {
    if (!mq.matches) return;
    dragging = true;
    startY = event.clientY;
    startH = side.getBoundingClientRect().height;
    side.style.transition = "none";
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onMove = (event) => {
    if (!dragging) return;
    // Drag up (clientY decreases) grows the sheet.
    side.style.height = clampPx(startH + (startY - event.clientY)) + "px";
    scheduleResize();
  };

  const onUp = (event) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(event.pointerId);
    const frac = side.getBoundingClientRect().height / total();
    const nearest = SNAPS.reduce((a, b) => (Math.abs(b - frac) < Math.abs(a - frac) ? b : a));
    side.style.transition = "height .24s cubic-bezier(.4, 0, .2, 1)";
    setFrac(nearest);
    try { localStorage.setItem(KEY, String(nearest)); } catch { /* private mode */ }
    setTimeout(resizeMap, 260);
  };

  // Enter mobile: restore the saved snap (or the default). Leave mobile: drop
  // the inline height so the desktop fixed-width sidebar rules take over.
  const sync = () => {
    if (dragging) return;
    if (mq.matches) {
      const saved = savedFrac();
      side.style.transition = "none";
      setFrac(saved > 0 && saved < 1 ? saved : DEFAULT);
    } else {
      side.style.height = "";
      side.style.transition = "";
    }
    resizeMap();
  };

  handle.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  mq.addEventListener?.("change", sync);
  window.addEventListener("resize", sync);
  sync();

  return () => {
    handle.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    mq.removeEventListener?.("change", sync);
    window.removeEventListener("resize", sync);
  };
}

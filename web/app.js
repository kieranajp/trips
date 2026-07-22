import { render } from "preact";
import { html } from "htm/preact";
import { App } from "./components/App.js";
import { trip } from "./state/signals.js";
import { initSync } from "./state/persistence.js";
import { boot } from "./state/trips.js";
import { checkAuth } from "./state/auth.js";

await boot();
render(html`<${App}/>`, document.getElementById("app"));
if (trip.value) initSync();

// Discover login state, and re-check on focus in case the session expired or
// the user logged in/out in another tab.
checkAuth();
window.addEventListener("focus", checkAuth);

// PWA: the service worker only adds offline fallback (network-first), so a
// registration failure is harmless — log it and move on.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("sw registration failed", err));
}

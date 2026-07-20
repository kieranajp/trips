import { computed, signal } from "@preact/signals";

// user: null until we've checked; then null = logged out, or { user, name }.
export const authUser = signal(null);
// ready flips true once the first /whoami check resolves, so the header can
// avoid flashing a login button before we know the real state.
export const authReady = signal(false);
// canEdit gates every mutating control in the UI. The hard boundary is the
// ingress (writes require login regardless); this is the matching UX.
export const canEdit = computed(() => !!authUser.value);

// checkAuth probes /whoami, which the ingress routes through forward-auth.
// Logged in -> 200 JSON with the Authentik identity. Logged out -> the outpost
// 302s; redirect:manual turns that into an opaque response (status 0, !ok) that
// we read as "logged out" without the redirect hijacking the page.
export async function checkAuth() {
  try {
    const res = await fetch("/whoami", { redirect: "manual" });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      authUser.value = data && data.user ? data : { user: "", name: "" };
    } else {
      authUser.value = null;
    }
  } catch (_) {
    authUser.value = null;
  } finally {
    authReady.value = true;
  }
}

// login is a full-page navigation so the forward-auth redirect can complete
// (a fetch can't). /login bounces us back here once the session is set.
export function login() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = "/login?next=" + next;
}

// logout clears the Authentik proxy session via the outpost sign-out endpoint.
export function logout() {
  location.href = "/outpost.goauthentik.io/sign_out";
}

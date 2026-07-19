import { html } from "htm/preact";
import { trips } from "../state/signals.js";

export function TripPicker() {
  return html`
    <div class="picker">
      <div class="picker-inner">
        <div class="brand">Trips</div>
        <p class="picker-lead">Pick a trip to open its map.</p>
        <div class="trip-cards">
          ${trips.value.map((trip) => html`
            <a class="trip-card" href=${`?trip=${trip.id}`} style=${trip.accent ? `--accent:${trip.accent}` : ""}>
              <div class="tc-title">${trip.title} ${trip.subtitle ? html`<em>${trip.subtitle}</em>` : null}</div>
              ${trip.blurb ? html`<div class="tc-blurb">${trip.blurb}</div>` : null}
            </a>`)}
          ${!trips.value.length ? html`<div class="empty">No trips defined yet.</div>` : null}
        </div>
      </div>
    </div>`;
}

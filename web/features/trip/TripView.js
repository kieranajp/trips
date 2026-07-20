import { html } from "htm/preact";
import { flights, stays, tab } from "../../state/signals.js";
import { editLog, removeFlight, removeStay } from "../../state/actions.js";
import { fmtDateTime, fmtTime, nights, sameDay } from "./format.js";

const byTime = (key) => (a, b) => String(a[key] || "").localeCompare(String(b[key] || ""));

function FlightCard({ flight }) {
  const route = [flight.from, flight.to].filter(Boolean).join(" → ");
  const carrier = [flight.airline, flight.number].filter(Boolean).join(" ");
  const when = flight.depart
    ? (sameDay(flight.depart, flight.arrive)
        ? `${fmtDateTime(flight.depart)} – ${fmtTime(flight.arrive)}`
        : [fmtDateTime(flight.depart), flight.arrive ? fmtDateTime(flight.arrive) : null].filter(Boolean).join(" → "))
    : "";
  return html`
    <div class="logi">
      <div class="logi-glyph">✈</div>
      <div class="logi-body" onClick=${() => editLog("flight", flight)}>
        <div class="logi-hd">${route || carrier || "Flight"}</div>
        ${carrier && route ? html`<div class="logi-sub">${carrier}</div>` : null}
        ${when ? html`<div class="logi-when">${when}</div>` : null}
        ${flight.confirmation ? html`<div class="logi-meta">Ref ${flight.confirmation}</div>` : null}
        ${flight.note ? html`<div class="logi-note">${flight.note}</div>` : null}
      </div>
      <span class="logi-x" title="Remove" onClick=${() => removeFlight(flight.id)}>×</span>
    </div>`;
}

function StayCard({ stay }) {
  const count = nights(stay.checkIn, stay.checkOut);
  return html`
    <div class="logi">
      <div class="logi-glyph">🛏</div>
      <div class="logi-body" onClick=${() => editLog("stay", stay)}>
        <div class="logi-hd">${stay.name || "Stay"}</div>
        ${stay.address ? html`<div class="logi-sub">${stay.address}</div>` : null}
        ${stay.checkIn || stay.checkOut ? html`
          <div class="logi-when">
            ${stay.checkIn ? html`In ${fmtDateTime(stay.checkIn)}` : null}
            ${stay.checkIn && stay.checkOut ? " · " : null}
            ${stay.checkOut ? html`Out ${fmtDateTime(stay.checkOut)}` : null}
            ${count ? html`<span class="logi-nights">${count} night${count === 1 ? "" : "s"}</span>` : null}
          </div>` : null}
        <div class="logi-meta">
          ${stay.confirmation ? html`<span>Ref ${stay.confirmation}</span>` : null}
          ${stay.url ? html`<a href=${stay.url} target="_blank" rel="noopener" onClick=${(event) => event.stopPropagation()}>Booking ↗</a>` : null}
        </div>
        ${stay.note ? html`<div class="logi-note">${stay.note}</div>` : null}
      </div>
      <span class="logi-x" title="Remove" onClick=${() => removeStay(stay.id)}>×</span>
    </div>`;
}

export function TripView() {
  const sortedFlights = [...flights.value].sort(byTime("depart"));
  const sortedStays = [...stays.value].sort(byTime("checkIn"));
  return html`
    <section class=${"view" + (tab.value === "trip" ? " on" : "")} id="view-trip">
      <div class="trip-inner">
        <p class="lead">Your travel logistics — the bits you scramble for at the airport. Kept on your device and synced across them, same as your pins.</p>

        <div class="logi-hdr">
          <h3>Flights</h3>
          <button class="btn mini primary" onClick=${() => editLog("flight")}>+ Add flight</button>
        </div>
        ${sortedFlights.length
          ? sortedFlights.map((flight) => html`<${FlightCard} key=${flight.id} flight=${flight}/>`)
          : html`<div class="empty">No flights yet. Add your outbound and return so the times are one tap away.</div>`}

        <div class="logi-hdr">
          <h3>Stays</h3>
          <button class="btn mini primary" onClick=${() => editLog("stay")}>+ Add stay</button>
        </div>
        ${sortedStays.length
          ? sortedStays.map((stay) => html`<${StayCard} key=${stay.id} stay=${stay}/>`)
          : html`<div class="empty">No stays yet. Add a hotel or rental with its check-in and check-out.</div>`}
      </div>
    </section>`;
}

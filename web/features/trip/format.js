// Formatting helpers for the "YYYY-MM-DDTHH:mm" local strings that
// <input type="datetime-local"> produces. No timezone maths — a flight's
// times are always in each airport's own local clock, as printed on the ticket.

const parse = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function fmtDateTime(value) {
  const date = parse(value);
  if (!date) return value || "";
  return date.toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function fmtTime(value) {
  const date = parse(value);
  if (!date) return value || "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(value) {
  const date = parse(value);
  if (!date) return value || "";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// Whole nights between two check-in/out datetimes, or null if either is unset.
export function nights(checkIn, checkOut) {
  const start = parse(checkIn);
  const end = parse(checkOut);
  if (!start || !end) return null;
  const days = Math.round((end - start) / 86400000);
  return days > 0 ? days : null;
}

// Same calendar day? Lets a flight collapse to one date + two times.
export function sameDay(a, b) {
  const first = parse(a);
  const second = parse(b);
  if (!first || !second) return false;
  return first.toDateString() === second.toDateString();
}

// Helpers for the "YYYY-MM-DD" local date strings that <input type="date">
// produces (a pin's visited day). Parsed field-by-field on purpose:
// new Date("YYYY-MM-DD") reads as UTC midnight, which shifts the calendar day
// in timezones west of Greenwich.

const pad = (number) => String(number).padStart(2, "0");

export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function fmtDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return value || "";
  const date = new Date(+match[1], +match[2] - 1, +match[3]);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

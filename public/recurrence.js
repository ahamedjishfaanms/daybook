// Repeat / recurrence helpers (pure functions, no Firebase) — also unit-testable in Node.
// repeat = { type: 'none' | 'daily' | 'weekly' | 'monthly', days?: number[] (0=Sun..6=Sat) }

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Next occurrence strictly after `from`, keeping the same clock time. */
export function nextOccurrence(from, repeat) {
  if (!repeat || repeat.type === "none") return null;
  const base = new Date(from);

  if (repeat.type === "daily") {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return d;
  }

  if (repeat.type === "weekly") {
    const days = repeat.days && repeat.days.length ? repeat.days : [base.getDay()];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      if (days.includes(d.getDay())) return d;
    }
  }

  if (repeat.type === "monthly") {
    const wanted = repeat.dayOfMonth || base.getDate();
    const d = new Date(base);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(wanted, lastDay));
    return d;
  }
  return null;
}

/** First occurrence on/after the chosen start (e.g. start is Wed but repeat is Mon/Tue -> next Mon). */
export function firstOccurrence(start, repeat) {
  const d = new Date(start);
  if (repeat?.type === "weekly" && repeat.days?.length && !repeat.days.includes(d.getDay())) {
    return nextOccurrence(d, repeat);
  }
  return d;
}

/** Next occurrence that is in the future (skips cycles that were missed). */
export function nextFutureOccurrence(from, repeat, now = new Date()) {
  let d = nextOccurrence(from, repeat);
  let guard = 0;
  while (d && d <= now && guard++ < 1000) d = nextOccurrence(d, repeat);
  return d;
}

export function describeRepeat(repeat) {
  if (!repeat || repeat.type === "none") return "";
  if (repeat.type === "daily") return "Every day";
  if (repeat.type === "monthly") return repeat.dayOfMonth ? `Monthly on day ${repeat.dayOfMonth}` : "Every month";
  if (repeat.type === "weekly") {
    const days = [...(repeat.days || [])].sort();
    if (days.length === 7) return "Every day";
    if (days.join() === "1,2,3,4,5") return "Every weekday";
    if (days.join() === "0,6") return "Every weekend";
    return "Every " + days.map((d) => DAY_NAMES[d]).join(", ");
  }
  return "";
}

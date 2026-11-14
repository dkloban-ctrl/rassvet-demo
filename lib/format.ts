const TZ = "Europe/Minsk";

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: TZ }).format(new Date(iso));

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: TZ })
    .format(new Date(iso));

export const fmtWeekday = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(new Date(iso));

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));

/** Неделя по понедельнику: «9–15 ноября». */
export function fmtWeek(mondayIso: string) {
  const start = new Date(mondayIso + "T12:00:00Z");
  const end = new Date(start.getTime() + 6 * 86400000);
  const dm = (x: Date) =>
    new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(x);
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()}–${dm(end)}`
    : `${dm(start)} – ${dm(end)}`;
}

/** Понедельник текущей недели в формате YYYY-MM-DD. */
export function currentMonday(offsetWeeks = 0): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offsetWeeks * 7);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${monday.getFullYear()}-${p(monday.getMonth() + 1)}-${p(monday.getDate())}`;
}

/** Для <input type="datetime-local"> */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

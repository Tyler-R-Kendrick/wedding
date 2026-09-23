/** "4:00 pm CT" style times in the wedding's time zone (wedding-site-standards §4: times carry a time zone). */
export function formatTimeIn(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d).replace(' AM', ' am').replace(' PM', ' pm');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A partial date as the couple recorded it: "2023" · "May 2023" · "May 6, 2023" — never padded to look exact. */
export function formatPartialDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-');
  const month = m ? MONTHS[Number(m) - 1] : undefined;
  if (!month) return y;
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
}

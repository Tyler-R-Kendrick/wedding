/** "4:00 pm CT" style times in the wedding's time zone (wedding-site-standards §4: times carry a time zone). */
export function formatTimeIn(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d).replace(' AM', ' am').replace(' PM', ' pm');
}

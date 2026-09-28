/**
 * Up/Down for a list the couple order by hand (funds, hotels, links, places, events, content records).
 *
 * `rows` is the list as the page shows it, top first. The row trades places with its neighbour, then
 * the new order is walked from the top: a row keeps its number when it is already above the row
 * before it, and otherwise takes that row's number plus ten. So a move writes only the rows that
 * have to change — usually one — rows that shared a number are pulled apart instead of left to
 * chance, and a row nobody moved (a built-in fund at its built-in place) is never rewritten.
 *
 * Pure, so a server page can build the `QuickAction` calls and a client flow can build them the same
 * way. Returns no calls when there is nowhere to move (the top row's Up, the bottom row's Down).
 */
export function moveCalls<T extends { sortOrder: number }>(
  rows: readonly T[],
  index: number,
  direction: 'up' | 'down',
  build: (r: T, patch: { sortOrder: number }) => unknown,
  capability: string,
  /** The highest number the capability accepts. A walk that would pass it renumbers the whole list inside it. */
  max = 1000,
): { capability: string; input: unknown }[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  const row = rows[index];
  const other = rows[target];
  if (!row || !other) return [];
  const order = [...rows];
  order[index] = other;
  order[target] = row;
  let previous = -Infinity;
  let numbers = order.map((r) => (previous = r.sortOrder > previous ? r.sortOrder : previous + 10));
  if (previous > max) {
    const step = Math.max(1, Math.min(10, Math.floor(max / order.length)));
    numbers = order.map((_, i) => (i + 1) * step);
  }
  return order.flatMap((r, i) => (numbers[i] === r.sortOrder ? [] : [{ capability, input: build(r, { sortOrder: numbers[i]! }) }]));
}

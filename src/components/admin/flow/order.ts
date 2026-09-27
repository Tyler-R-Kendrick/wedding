/**
 * Up/Down for a list the couple order by hand (funds, hotels, links, places, events, content records).
 *
 * `rows` is the list as the page shows it, top first, sorted by `sortOrder`. When every row has its
 * own number, a move is two saves: the row and its neighbour trade numbers. When any two rows share a
 * number (a list whose rows all started at 0 or 100, or one a failed move left half-done), trading
 * would leave the order to chance, so the whole list is renumbered in its new order (10, 20, 30…)
 * and only the rows whose number changes are saved. Either way the result is the order the admin
 * asked for, and the next move starts from unique numbers.
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
): { capability: string; input: unknown }[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  const row = rows[index];
  const other = rows[target];
  if (!row || !other) return [];
  const unique = rows.every((r, i) => i === 0 || r.sortOrder > rows[i - 1]!.sortOrder);
  if (unique) {
    return [
      { capability, input: build(row, { sortOrder: other.sortOrder }) },
      { capability, input: build(other, { sortOrder: row.sortOrder }) },
    ];
  }
  const order = [...rows];
  order[index] = other;
  order[target] = row;
  return order.flatMap((r, i) => {
    const sortOrder = (i + 1) * 10;
    return r.sortOrder === sortOrder ? [] : [{ capability, input: build(r, { sortOrder }) }];
  });
}

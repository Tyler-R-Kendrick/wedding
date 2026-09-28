'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type ListOption = { value: string; label: string };

const Lists = createContext<Record<string, ListOption[]>>({});

/**
 * The option lists a page's rows choose from (households, guests, tables), sent to the browser once
 * for the whole list. Handed to every row instead, a picker makes the page grow with the rows times
 * the options: two hundred guests each carrying every other guest was forty thousand options in the
 * HTML and seconds per render.
 */
export function ListsProvider({ lists, children }: { lists: Record<string, ListOption[]>; children: ReactNode }) {
  // A server page passes these; they change only when the page itself is rendered again.
  return <Lists.Provider value={lists}>{children}</Lists.Provider>;
}

/**
 * A list from the nearest `ListsProvider`, or `given` when the caller passes one itself. `T` is what
 * the page put under `name` (options may carry more than a value and a label).
 */
export function useList<T extends ListOption = ListOption>(name: string, given?: T[]): T[] {
  const lists = useContext(Lists);
  return given ?? ((lists[name] ?? []) as T[]);
}

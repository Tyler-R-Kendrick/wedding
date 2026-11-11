import { defineFunction } from '@openuidev/react-lang';
import { z } from 'zod/v4';

/*
 * @Toggle, @Includes and @Clamp, ported from open-intelligent-ui (thesysdev), MIT licence:
 *
 *   Copyright (c) 2026 Thesys Inc.
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 *   associated documentation files (the "Software"), to deal in the Software without restriction,
 *   including without limitation the rights to use, copy, modify, merge, publish, distribute,
 *   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the Software.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 *   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
 *   OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Only what the composer writes is ported: the time tool ticks rows in and out of a `$variable` list.
 */

/** Equality by value, so an id read from an input as a string still matches its number form. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((typeof a === 'number' && typeof b === 'string') || (typeof a === 'string' && typeof b === 'number')) return String(a) === String(b);
  return false;
}

const list = () => z.array(z.any());

export const Toggle = defineFunction({
  name: 'Toggle',
  description: 'Adds item if missing, removes it if present (a set of strings or numbers)',
  params: z.object({ list: list(), item: z.any() }),
  returns: list(),
  fn: ({ list, item }) => (list.some((x) => same(x, item)) ? list.filter((x) => !same(x, item)) : [...list, item]),
});

export const Includes = defineFunction({
  name: 'Includes',
  description: 'True if the list has item, or the text contains it',
  params: z.object({ list: z.union([list(), z.string()]), item: z.any() }),
  returns: z.boolean(),
  fn: ({ list, item }) => (typeof list === 'string' ? item != null && list.includes(String(item)) : list.some((x) => same(x, item))),
});

export const Clamp = defineFunction({
  name: 'Clamp',
  description: 'number kept between min and max',
  params: z.object({ number: z.number(), min: z.number(), max: z.number() }),
  returns: z.number(),
  fn: ({ number, min, max }) => Math.min(Math.max(number, Math.min(min, max)), Math.max(min, max)),
});

export const tripFunctions = [Toggle, Includes, Clamp];

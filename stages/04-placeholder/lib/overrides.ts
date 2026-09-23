/**
 * Hand-written stand-ins, by slot key. A key is `<pageId>/<blockId>/<part>`, or a `*` in place of the page id
 * for every page (the site chrome, e.g. `*` + `/site/name`). Find a key in the browser: every filled slot carries it as
 * `data-slot`. Keep these honest: a label, a length, a TODO. Real copy belongs to the real app.
 */
export const OVERRIDES: Record<string, string> = {
  '*/site/name': 'Sara + Tyler',
  '*/site/footer': 'Footer: how to reach us, photo credits, and the way to sign in.',
  'home/hero/lede': 'Date · place. The real ones arrive with the real content, at stage 5.',
};

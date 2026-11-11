import type { ReactNode } from 'react';

/** The site's one design (src/themes/registry.ts); scripts/sync-themes.mjs copies its tokens in. */
export const THEME = 'botanical-deco';

/**
 * Wraps a page drawn from the sitemap in the real design: its tokens are loaded
 * (app/themes/index.css, scoped by `[data-theme]`) and app/designs.css points the stage 3 kit at
 * them.
 */
export function ThemedSite({ children }: { children: ReactNode }) {
  return (
    <div className="pl-site" data-theme={THEME}>
      {children}
    </div>
  );
}

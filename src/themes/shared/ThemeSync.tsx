'use client';

import { useEffect } from 'react';
import type { ThemeId } from '@/themes/types';

/**
 * Mirrors the Shell's data-theme onto <html> after hydration and on client navigations (from a
 * page that carries none, such as the admin console), so html/body-level styles follow the
 * wrapper. The theme layout's inline script does the same before first paint.
 */
export function ThemeSync({ theme }: { theme: ThemeId }) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
}

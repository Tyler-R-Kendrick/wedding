'use client';

import { useId, useSyncExternalStore, type ReactNode } from 'react';

export interface ThemeOption {
  id: string;
  name: string;
  description: string;
  approved: boolean;
}

/** The drafting sheet itself: stage 3's look, for comparing a design against no design. */
const NONE = 'none';
const STORE = 'stage4.theme';

let chosen: string | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readInitial(themes: ThemeOption[]): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORE);
  } catch {
    // Private windows and blocked storage: the default is fine.
  }
  const wanted = fromUrl ?? stored;
  return wanted && (wanted === NONE || themes.some((t) => t.id === wanted)) ? wanted : null;
}

/**
 * Wraps the page in the chosen design. Every design's tokens are loaded (app/themes/index.css,
 * scoped by `[data-theme]`), so switching is one attribute: no reload, and the page keeps its
 * scroll position and form state, which is the point of comparing designs on the same structure.
 * The choice travels in `?theme=` so a link shows a reviewer the same design.
 */
export function ThemedSite({ themes, children }: { themes: ThemeOption[]; children: ReactNode }) {
  const fallback = themes[0]?.id ?? NONE;
  // The server (and the first client render) show the approved design; the browser then reads
  // ?theme= or the remembered choice. An external store, because the URL and storage are one.
  const theme = useSyncExternalStore(subscribe, () => chosen ?? readInitial(themes) ?? fallback, () => fallback);
  const selectId = useId();

  const choose = (id: string) => {
    chosen = id;
    try {
      window.localStorage.setItem(STORE, id);
    } catch {
      // Not remembered; still applied.
    }
    const url = new URL(window.location.href);
    url.searchParams.set('theme', id);
    window.history.replaceState(null, '', url);
    listeners.forEach((l) => l());
  };

  const current = themes.find((t) => t.id === theme);
  return (
    <>
      <div className="pl-picker">
        <label htmlFor={selectId} className="pl-picker__label">Design</label>
        <select id={selectId} className="pl-picker__select" value={theme} onChange={(e) => choose(e.target.value)}>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.approved ? ' (approved)' : ''}</option>
          ))}
          <option value={NONE}>No design (drafting sheet)</option>
        </select>
        <p className="pl-picker__about">{current ? current.description : 'The stage 3 drafting sheet: the structure with no design applied.'}</p>
      </div>
      <div className="pl-site" data-theme={theme === NONE ? undefined : theme}>
        {children}
      </div>
    </>
  );
}

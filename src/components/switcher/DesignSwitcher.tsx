'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { DialogBase } from '@/themes/shared/DialogBase';
import type { ThemeId } from '@/themes/types';
import { setThemeAction } from './actions';

export interface DesignSwitcherProps {
  current: ThemeId;
  themes: { id: ThemeId; name: string; tagline: string }[];
  /** trigger: a quiet button that opens a dialog; menu: the options inline inside a Menu sheet. */
  variant?: 'trigger' | 'menu';
  id?: string;
}

/**
 * Design switcher (ADR-0009 §5): a quiet control in the shell, never a floating chip. Kits place a
 * `trigger` in the frieze/rail and the footer, and a `menu` variant inside the phone Menu sheet.
 * Choosing runs the server action (device cookie via `navigate_to`), drops a `?theme=` query
 * (it would win over the cookie on the next request), then refreshes so the proxy re-resolves.
 * `ThemeSync` owns `html[data-theme]`. Hidden entirely when FLAG_DESIGN_SWITCHER is off.
 */
export function DesignSwitcher({ current, themes, variant = 'trigger', id = 'design-switcher' }: DesignSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const currentName = themes.find((t) => t.id === current)?.name ?? current;

  const choose = (formData: FormData) => {
    startTransition(async () => {
      setError(null);
      const result = await setThemeAction(formData);
      if (!result.ok) {
        setError(result.message ?? 'That design is not available.');
        return;
      }
      formRef.current?.closest('dialog')?.close();
      if (new URLSearchParams(window.location.search).has('theme')) router.replace(pathname, { scroll: false });
      router.refresh();
      // Announce outside the themed shell (which remounts on a swap) and move focus to the content.
      const chosen = themes.find((t) => t.id === result.theme)?.name ?? result.theme ?? 'the other design';
      const announcer = document.getElementById('design-announcer');
      if (announcer) announcer.textContent = `Design changed to ${chosen}.`;
      document.getElementById('main')?.focus({ preventScroll: true });
    });
  };

  const form = (
    <form ref={formRef} action={choose} className={`switcher__form switcher__form--${variant}`} aria-labelledby={variant === 'menu' ? `${id}-label` : undefined}>
      {variant === 'menu' ? (
        <p className="switcher__heading" id={`${id}-label`}>
          Design
        </p>
      ) : (
        <p className="switcher__intro">Two designs, one wedding. Your choice stays on this device.</p>
      )}
      <ul className="switcher__options">
        {themes.map((t) => (
          <li key={t.id}>
            <button type="submit" name="theme" value={t.id} className="switcher__option" aria-pressed={t.id === current} disabled={pending} data-autofocus={variant === 'trigger' && t.id === current ? '' : undefined}>
              <span className="switcher__name">{t.name}</span>
              <span className="switcher__tagline">{t.tagline}</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="switcher__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );

  if (variant === 'menu') {
    return (
      <div className="switcher switcher--menu" data-pending={pending || undefined}>
        {form}
      </div>
    );
  }
  return (
    <div className="switcher switcher--trigger" data-pending={pending || undefined}>
      <DialogBase
        id={id}
        title="Choose a design"
        trigger={
          <>
            <span>Design</span>
            <span className="switcher__current">{currentName}</span>
          </>
        }
        triggerLabel={`Design: ${currentName}. Choose a design`}
        classNames={{
          trigger: 'switcher__trigger',
          dialog: 'switcher__dialog',
          panel: 'switcher__panel',
          header: 'switcher__header',
          title: 'switcher__title',
          close: 'switcher__close',
          body: 'switcher__body',
        }}
      >
        {form}
      </DialogBase>
    </div>
  );
}

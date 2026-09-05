'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DialogBase } from '@/themes/shared/DialogBase';
import type { ThemeId } from '@/themes/types';
import { setThemeAction } from './actions';

export interface DesignSwitcherProps {
  current: ThemeId;
  themes: { id: ThemeId; name: string; tagline: string }[];
}

const DIALOG_ID = 'design-switcher';

/**
 * Floating "Design" control (ADR-0009 §5): a quiet button that opens a native dialog with the two
 * designs. Choosing one runs the server action (cookie), closes the dialog, and refreshes the
 * route so the proxy re-resolves the theme. Hidden entirely when FLAG_DESIGN_SWITCHER is off
 * (the server never renders it). Keyboard: Tab to the button, Enter opens, arrow/Tab between options, Esc closes.
 */
export function DesignSwitcher({ current, themes }: DesignSwitcherProps) {
  const router = useRouter();
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
      (document.getElementById(DIALOG_ID) as HTMLDialogElement | null)?.close();
      if (result.theme) document.documentElement.dataset.theme = result.theme;
      router.refresh();
    });
  };

  return (
    <div className="switcher" data-pending={pending || undefined}>
      <DialogBase
        id={DIALOG_ID}
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
        <form action={choose}>
          <p className="switcher__intro">Two designs, one wedding. Your choice stays on this device.</p>
          <ul className="switcher__options">
            {themes.map((t) => (
              <li key={t.id}>
                <button type="submit" name="theme" value={t.id} className="switcher__option" aria-pressed={t.id === current} disabled={pending}>
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
      </DialogBase>
    </div>
  );
}

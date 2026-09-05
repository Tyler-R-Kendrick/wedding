'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface DialogBaseProps {
  id: string;
  title: string;
  trigger: ReactNode;
  triggerLabel?: string;
  children: ReactNode;
  closeLabel?: string;
  classNames: { trigger: string; dialog: string; panel: string; header: string; title: string; close: string; body: string };
  /** Optional decoration rendered inside the panel before the header (theme ornament). */
  ornament?: ReactNode;
}

/**
 * Headless modal on the native <dialog>: focus is trapped and returned by the platform, Esc closes,
 * `aria-modal` is implicit. Each theme supplies markup classes and its own open/close choreography in CSS.
 */
export function DialogBase({ id, title, trigger, triggerLabel, children, closeLabel = 'Close', classNames, ornament }: DialogBaseProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    const el = ref.current;
    if (el?.open) el.close();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClose = () => setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (e.target === el) el.close(); // backdrop click
    };
    el.addEventListener('close', onClose);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('close', onClose);
      el.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <>
      <button type="button" className={classNames.trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={triggerLabel} onClick={show}>
        {trigger}
      </button>
      <dialog id={id} ref={ref} className={classNames.dialog} aria-labelledby={titleId}>
        <div className={classNames.panel}>
          {ornament}
          <div className={classNames.header}>
            <h2 id={titleId} className={classNames.title}>
              {title}
            </h2>
            <button type="button" className={classNames.close} onClick={hide}>
              {closeLabel}
            </button>
          </div>
          <div className={classNames.body}>{children}</div>
        </div>
      </dialog>
    </>
  );
}

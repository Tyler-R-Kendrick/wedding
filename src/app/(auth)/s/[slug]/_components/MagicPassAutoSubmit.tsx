'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

/**
 * Submits the sign-in pass form once on mount so guests with a printed QR need not tap Continue.
 * Prefetchers that only GET the page never POST, so the code is not consumed by email scanners.
 */
export function MagicPassForm({
  slug,
  code,
  action,
  disabled,
  children,
}: {
  slug: string;
  code: string;
  action: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (disabled) return;
    formRef.current?.requestSubmit();
  }, [disabled]);
  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="code" value={code} />
      {children}
    </form>
  );
}

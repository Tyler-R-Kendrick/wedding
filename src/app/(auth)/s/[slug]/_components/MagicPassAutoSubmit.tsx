'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

/** One auto-submit per slug per document (React Strict Mode remounts would POST twice otherwise). */
const autoSubmittedSlugs = new Set<string>();

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
    if (autoSubmittedSlugs.has(slug)) return;
    autoSubmittedSlugs.add(slug);
    formRef.current?.requestSubmit();
  }, [disabled, slug]);
  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="code" value={code} />
      {children}
    </form>
  );
}

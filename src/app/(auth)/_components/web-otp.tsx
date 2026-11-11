'use client';

import { useEffect } from 'react';

/**
 * WebOTP (`navigator.credentials.get({ otp })`) for SMS in the future.
 * Browsers that support it may offer to fill a one-time code; we only wire the hook here.
 */
export function useWebOtp(onCode: (code: string) => void, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const nav = navigator as Navigator & {
      credentials?: CredentialsContainer & {
        get?: (options: { otp: { transport: string[] } }) => Promise<{ code?: string } | null>;
      };
    };
    if (!nav.credentials?.get) return;
    let cancelled = false;
    nav.credentials
      .get({ otp: { transport: ['sms'] } })
      .then((cred) => {
        if (cancelled || !cred?.code) return;
        onCode(cred.code);
      })
      .catch(() => {
        // Unsupported, denied, or no SMS — expected on most visits today.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, onCode]);
}

/** Optional helper for visible code fields (email OTP and magic pass fallback). */
export function WebOtpInputSync({ inputId, enabled = true }: { inputId: string; enabled?: boolean }) {
  useWebOtp((code) => {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    if (!el) return;
    el.value = code.replace(/\D/g, '').slice(0, 6);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, enabled);
  return null;
}

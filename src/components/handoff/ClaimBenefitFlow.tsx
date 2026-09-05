'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConfirmationCard } from './ConfirmationCard';
import { callCapability, newIdempotencyKey } from './client';

interface DraftData {
  benefit: { program: string; amountNote: string | null; validityNote: string | null; geofenceNote: string | null; statusMessage: string };
  claimable: boolean;
  provider: { displayName: string; testMode: boolean; redemptionKind: 'link' | 'code' };
  disclosure: string;
  confirmInput: { entitlementId: string };
}

type Step = { name: 'idle' } | { name: 'drafting' } | { name: 'review'; draft: DraftData; token: string; expiresAt: string } | { name: 'claiming' } | { name: 'done'; redemptionKind: 'link' | 'code' } | { name: 'error'; message: string; retry: boolean };

const BUTTON = 'inline-flex min-h-11 items-center rounded-full px-7 py-3 text-[0.75rem] uppercase tracking-[0.14em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60';
const PRIMARY = `${BUTTON} bg-primary text-neutral`;
const GHOST = `${BUTTON} border border-primary/40 text-primary`;

/**
 * Draft → review → confirm for a ride benefit. The server issues a token bound to this exact
 * payload; the claim is retried with the same idempotency key; on success the page re-renders
 * and the redemption card (server-rendered, owner only) appears. Nothing here decides anything.
 */
export function ClaimBenefitFlow({ entitlementId, program }: { entitlementId: string; program: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'idle' });
  const keyRef = useRef<string | null>(null);

  const draft = async () => {
    setStep({ name: 'drafting' });
    const res = await callCapability<DraftData>('draft_my_transportation_claim', { input: { entitlementId } });
    if (!res.ok || !res.data) return setStep({ name: 'error', message: messageFor(res.error), retry: true });
    if (!res.data.claimable || !res.confirmation) return setStep({ name: 'error', message: res.data.benefit.statusMessage, retry: false });
    keyRef.current ??= newIdempotencyKey();
    setStep({ name: 'review', draft: res.data, token: res.confirmation.token, expiresAt: res.confirmation.expiresAt });
  };

  const confirm = async (token: string, input: { entitlementId: string }) => {
    setStep({ name: 'claiming' });
    const res = await callCapability<{ redemptionKind: 'link' | 'code' }>('claim_my_transportation_benefit', { input, idempotencyKey: keyRef.current ?? newIdempotencyKey(), confirmationToken: token });
    if (!res.ok || !res.data) {
      if (res.error?.code === 'confirmation_required') {
        keyRef.current = null;
        return setStep({ name: 'error', message: 'That review expired. Please review again.', retry: true });
      }
      if (res.error?.code === 'conflict') {
        router.refresh();
        return setStep({ name: 'error', message: messageFor(res.error), retry: false });
      }
      return setStep({ name: 'error', message: messageFor(res.error), retry: true });
    }
    setStep({ name: 'done', redemptionKind: res.data.redemptionKind });
    router.refresh();
  };

  if (step.name === 'review') {
    const d = step.draft;
    return (
      <ConfirmationCard
        title={`Claim your ride benefit`}
        rows={[
          { label: 'Programme', value: d.benefit.program },
          { label: 'Amount', value: d.benefit.amountNote ?? 'To be confirmed' },
          { label: 'Valid', value: d.benefit.validityNote ?? 'To be confirmed' },
          { label: 'Area', value: d.benefit.geofenceNote ?? 'To be confirmed' },
          { label: 'Issued by', value: `${d.provider.displayName}${d.provider.testMode ? ' (test mode)' : ''}` },
          { label: 'You will get', value: d.provider.redemptionKind === 'link' ? 'A link to open in the Uber app' : 'A code to enter in the Uber app' },
        ]}
        disclosure={d.disclosure}
      >
        <button type="button" className={PRIMARY} onClick={() => confirm(step.token, d.confirmInput)}>
          Confirm and claim
        </button>
        <button type="button" className={GHOST} onClick={() => setStep({ name: 'idle' })}>
          Not now
        </button>
      </ConfirmationCard>
    );
  }

  return (
    <div className="mt-4" data-claim-step={step.name}>
      {step.name === 'error' ? (
        <p role="alert" className="mb-3 max-w-[65ch]">
          {step.message}
        </p>
      ) : null}
      {step.name === 'done' ? (
        <p role="status" className="mb-3 max-w-[65ch]">
          Claimed. Your {step.redemptionKind === 'link' ? 'ride link' : 'ride code'} is below.
        </p>
      ) : null}
      {step.name === 'idle' || (step.name === 'error' && step.retry) ? (
        <button type="button" className={PRIMARY} onClick={draft} data-claim-program={program}>
          Review and claim
        </button>
      ) : null}
      {step.name === 'drafting' || step.name === 'claiming' ? (
        <p role="status" aria-live="polite">
          {step.name === 'drafting' ? 'Preparing your claim…' : 'Claiming…'}
        </p>
      ) : null}
    </div>
  );
}

function messageFor(error: { code: string; message: string } | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code === 'step_up_required') return 'For your security, please sign in again from your invitation link before claiming.';
  if (error.code === 'unauthenticated') return 'Please sign in from your invitation link to claim.';
  return error.message;
}

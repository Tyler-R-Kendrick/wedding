import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { setReadiness } from '@/lib/flags';
import { biometricServices } from './_shared';

const input = z.object({}).optional();
const output = z.object({ flag: z.boolean(), readiness: z.boolean(), enabled: z.boolean() });

/**
 * Switching the readiness half of the gate OFF. Deliberately the weakest possible door: no
 * confirmation token, no counsel reference, no feature flag — the same reasoning that keeps a
 * guest's withdrawal unconditional. Turning a biometric feature off must never be blocked by a
 * missing precondition. Clears the recorded review reference so it cannot appear to justify a
 * switch that is no longer on.
 */
export const adminDisableBiometricReadiness = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_disable_biometric_readiness',
  title: 'Switch biometric readiness off',
  description: 'Turns the persisted readiness switch for face matching off, immediately. Needs no confirmation token and no review reference: switching this off is always allowed. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_ai'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx) {
    const services = biometricServices(ctx);
    await setReadiness(services.db, { flag: 'BIOMETRICS_ENABLED', ready: false, actor: toPrincipalRef(ctx.principal), requestId: ctx.requestId, audit: ctx.audit });
    const readiness = await services.readiness('BIOMETRICS_ENABLED');
    return ok({ data: { flag: ctx.flags.BIOMETRICS_ENABLED, readiness, enabled: ctx.flags.BIOMETRICS_ENABLED && readiness }, sources: [] });
  },
});

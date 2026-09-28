'use client';

import { AdminFlow } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences } from '@/components/admin/flow/fields';

/**
 * Switches a legal gate's readiness off. Off only: there is no switch-on anywhere in this console,
 * and this flow's every button (the trigger, the submit) names the act as "… readiness off", which
 * tests/e2e/admin-console.spec.ts asserts of every control in a gate.
 *
 * The confirmation is a UI step, not a precondition the capability checks: closing a gate must never
 * be blocked by anything the server requires.
 */
export function DisableReadinessFlow({ flag, blockedBy }: { flag: string; blockedBy?: string }) {
  const act = `Switch ${flag} readiness off`;
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`flags:readiness-off:${flag}`}
      tone="danger"
      title={act}
      // Both gates' buttons were once named exactly "Switch off"; the name says which gate it closes.
      trigger={{ label: 'Switch off', variant: 'danger', accessibleName: act }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Switch ${flag} readiness off?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>{flag} stops at once, whatever the environment flag says: the persisted readiness switch is set off and the justification recorded on it is cleared.</p>
                <p>This console cannot switch it back on.</p>
                {blockedBy ? <p>What holds this gate shut: {blockedBy}</p> : null}
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={`Yes, switch ${flag} readiness off`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: act, capability: 'admin_disable_flag_readiness', input: () => ({ flag }), success: `${flag} readiness is off.` }}
    />
  );
}

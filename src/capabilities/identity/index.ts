import type { AnyCapability } from '@/contracts/capability';
import { adminGuestOpsCapabilities } from '../admin_guest_ops';
import { claimIdentity } from '../claim_identity';
import { getMyHousehold } from '../get_my_household';
import { getMyInvitation } from '../get_my_invitation';
import { lookupInvitation } from '../lookup_invitation';
import { registerPasskey } from '../register_passkey';
import { requestOtp } from '../request_otp';
import { stepUp } from '../step_up';
import { updateMyContact } from '../update_my_contact';
import { verifyOtp } from '../verify_otp';

/** Swarm D: identity, authentication, entitlements. Registered from src/capabilities/index.ts. */
export const identityCapabilities: readonly AnyCapability[] = [
  lookupInvitation, requestOtp, verifyOtp, claimIdentity, registerPasskey, stepUp, getMyInvitation, getMyHousehold, updateMyContact,
  ...adminGuestOpsCapabilities,
];

export { lookupInvitation, requestOtp, verifyOtp, claimIdentity, registerPasskey, stepUp, getMyInvitation, getMyHousehold, updateMyContact };

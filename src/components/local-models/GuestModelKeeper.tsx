import type { Principal } from "@/contracts/principal";
import { LocalModelKeeper } from "./LocalModelKeeper";

/**
 * The on-device models download for signed-in guests only: the guest pages mount this with the
 * reader they already resolved, and nobody else's browser fetches the weights. Public pages are
 * static and never mount it. Your Trip still installs a part on first use, behind its own sign-in.
 */
export function GuestModelKeeper({ principal }: { principal: Principal }) {
  return principal.kind === "guest" ? <LocalModelKeeper /> : null;
}

import { z } from 'zod';

/** Guest-safe shape of an outbound link as capabilities return it. */
export const guestHandoffSchema = z.object({
  provider: z.string(),
  providerDisplayName: z.string(),
  label: z.string(),
  url: z.url(),
  host: z.string(),
  opensNewTab: z.boolean(),
  disclosure: z.string(),
});

export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

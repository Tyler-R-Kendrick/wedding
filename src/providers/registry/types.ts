import { z } from 'zod';
import type { ExternalHandoff, ProviderDescriptor } from '@/contracts/providers';

/** A registry or gift link. Never a transaction: the site only describes where to go. */
export interface GiftLink extends ExternalHandoff {
  /** Stable id for analytics-free ordering in the UI. */
  id: string;
  /** 'zola' | 'theknot' | 'withjoy' | 'custom' */
  provider: string;
  /** Optional short note shown under the label (e.g. "Physical wishlist"). */
  note?: string;
}

export const giftLinkSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  provider: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  url: z.url(),
  note: z.string().max(200).optional(),
  disclosure: z.string().max(300).optional(),
});

export type GiftLinkInput = z.infer<typeof giftLinkSchema>;

export interface RegistryProvider extends ProviderDescriptor {
  kind: 'registry';
  describeLinks(): Promise<GiftLink[]>;
}

export interface CashFundProvider extends ProviderDescriptor {
  kind: 'cash-fund';
  describeLinks(): Promise<GiftLink[]>;
}

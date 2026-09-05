import type { Citation, TrustClass } from '@/contracts/provenance';
import type { AiAnswerStatus } from '@/db/schema/ai';

/**
 * One block of evidence the model may quote. Built from a capability result or a retrieved
 * knowledge record, labelled with its trust class, and rendered as a delimited "source" block in
 * the user turn (never in the system prompt). The marker ("S1") is what citations refer to.
 */
export interface SpotlightedSource {
  marker: string;
  citation: Citation;
  trust: TrustClass;
  /** Plain-text facts, one per line, already free of placeholder hints. */
  lines: string[];
  /** ISO time for EXTERNAL_DATA snapshots (ADR-0003 rule 3). */
  retrievedAt?: string;
  /** Capability name or "retrieval". */
  origin: string;
  /** Knowledge kind, capability output section, etc. For traces only. */
  kind?: string;
  /** Injection scanner findings. A flagged source is quarantined: never shown to the model. */
  flagged?: string[];
}

/** Guest-visible projection of a cited source ("Based on…"). */
export interface AnswerSource {
  marker: string;
  sourceId: string;
  title: string;
  url?: string;
  verifiedAt?: string;
  retrievedAt?: string;
  trustClass: TrustClass;
  recordRef?: { type: string; id: string };
}

/** A proposal the concierge drafted; the human confirms on the website, never here. */
export interface ConfirmationCard {
  capability: string;
  title: string;
  summary: string;
  /** Internal route where the guest reviews and confirms. */
  reviewRoute: string;
  expiresAt?: string;
  proposal?: unknown;
  reason: 'requires_ui' | 'step_up' | 'sign_in';
}

export interface AnswerLink {
  label: string;
  href: string;
}

export interface ConciergeResult {
  sessionId: string;
  answerId: string;
  status: AiAnswerStatus;
  /** Verified text with citation markers ("[S1]"). Empty for refusals. */
  text: string;
  sources: AnswerSource[];
  refusal?: { message: string; links: AnswerLink[] };
  confirmations: ConfirmationCard[];
  navigate?: { route: string; highlight?: string };
  intent: string;
  toolsSelected: string[];
  toolsDenied: string[];
  dropped: number;
  securityAlerts: number;
  latencyMs: number;
}

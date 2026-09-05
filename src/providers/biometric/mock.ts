import { CapabilityError } from '@/contracts/errors';
import { ok } from '@/contracts/result';
import { fnv1a, okConfig, upHealth } from '../base';
import { cosine } from '../vector-index/types';
import type { BiometricProvider, BiometricTemplate } from './types';

/** Flag + readiness (and, when a subject is named, that subject's consent). */
export type ReadinessCheck = (subjectId?: string) => Promise<boolean>;

export const MOCK_TEMPLATE_DIMS = 64;

/**
 * Deterministic "template" from the bytes: identical derivatives produce identical vectors,
 * different images produce uncorrelated ones. It detects nothing about faces; it exists so the
 * consent, gating, matching, and deletion paths can be exercised end to end without any real
 * biometric processing. Clearly labelled as such in validateConfig.
 */
export function mockTemplate(bytes: Uint8Array, dims = MOCK_TEMPLATE_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const chunk = Math.max(1, Math.floor(bytes.byteLength / 256));
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    const h = fnv1a(`${i}:${bytes[i]}:${bytes[Math.min(bytes.byteLength - 1, i + 1)]}`);
    v[h % dims] = (v[h % dims] ?? 0) + (((h >>> 8) & 1) ? 1 : -1);
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** In-memory mock. Vectors never leave the process; nothing is persisted. */
export class MockBiometric implements BiometricProvider {
  readonly kind = 'biometric' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { extract: true, enroll: true, match: true, delete: true };
  private readonly vault = new Map<string, { vector: number[]; enrolledAt: string }>();

  constructor(private readonly readiness: ReadinessCheck) {}

  validateConfig() {
    return okConfig(['mock biometric provider: detects no faces and must never be enabled in production without counsel review']);
  }
  async health() {
    return upHealth();
  }

  async assertReady(subjectId?: string) {
    if (!(await this.readiness(subjectId))) {
      throw new CapabilityError('feature_disabled', 'Face matching is not available.');
    }
  }

  async extract(input: { subjectId: string; bytes: Uint8Array; contentType: string }) {
    await this.assertReady(input.subjectId);
    const template: BiometricTemplate = { vector: mockTemplate(input.bytes), faceDetected: input.bytes.byteLength > 0, model: 'mock-template-64' };
    return ok(template);
  }

  async enroll(input: { subjectId: string; vector: number[] }) {
    await this.assertReady(input.subjectId);
    const enrolledAt = new Date().toISOString();
    this.vault.set(input.subjectId, { vector: [...input.vector], enrolledAt });
    return ok({ subjectId: input.subjectId, enrolledAt });
  }

  async match(input: { vector: number[]; k?: number; threshold?: number; subjectId?: string }) {
    await this.assertReady(input.subjectId);
    const threshold = input.threshold ?? 0.8;
    const scored = [...this.vault.entries()]
      // Consent-scoped: when a subject is named, only that subject's own enrolment is compared.
      .filter(([subjectId]) => !input.subjectId || subjectId === input.subjectId)
      .map(([subjectId, v]) => ({ subjectId, score: cosine(input.vector, v.vector) }))
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score);
    return ok(scored.slice(0, input.k ?? 5));
  }

  async delete(subjectId: string) {
    // Deletion must work even when the feature is switched off (retention obligations).
    return ok({ deleted: this.vault.delete(subjectId) });
  }

  /** Tests/ops: number of enrolled subjects held in memory. */
  size(): number {
    return this.vault.size;
  }
}

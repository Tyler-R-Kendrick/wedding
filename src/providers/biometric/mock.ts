import { CapabilityError } from '@/contracts/errors';
import { ok } from '@/contracts/result';
import { okConfig, upHealth } from '../base';
import { cosine } from '../vector-index/types';
import type { BiometricProvider } from './types';

export type ReadinessCheck = () => Promise<boolean>;

/** In-memory mock. Vectors never leave the process; nothing is persisted. */
export class MockBiometric implements BiometricProvider {
  readonly kind = 'biometric' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { enroll: true, match: true, delete: true };
  private readonly vault = new Map<string, { vector: number[]; enrolledAt: string }>();

  constructor(private readonly readiness: ReadinessCheck) {}

  validateConfig() {
    return okConfig(['mock biometric provider: never enable in production without counsel review']);
  }
  async health() {
    return upHealth();
  }

  async assertReady() {
    if (!(await this.readiness())) {
      throw new CapabilityError('feature_disabled', 'Face matching is not available.');
    }
  }

  async enroll(input: { subjectId: string; vector: number[] }) {
    await this.assertReady();
    const enrolledAt = new Date().toISOString();
    this.vault.set(input.subjectId, { vector: [...input.vector], enrolledAt });
    return ok({ subjectId: input.subjectId, enrolledAt });
  }

  async match(input: { vector: number[]; k?: number; threshold?: number }) {
    await this.assertReady();
    const threshold = input.threshold ?? 0.8;
    const scored = [...this.vault.entries()]
      .map(([subjectId, v]) => ({ subjectId, score: cosine(input.vector, v.vector) }))
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score);
    return ok(scored.slice(0, input.k ?? 5));
  }

  async delete(subjectId: string) {
    // Deletion must work even when the feature is switched off (retention obligations).
    return ok({ deleted: this.vault.delete(subjectId) });
  }
}

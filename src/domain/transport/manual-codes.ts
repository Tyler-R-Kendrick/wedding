import { getDb, type Db } from '@/db/client';
import type { PrincipalRef } from '@/contracts/principal';
import { installManualCodeSource, type ManualCodeSource } from '@/providers/transport-benefit/types';
import { getTransportVault, type Vault } from '../external/vault';
import { getManualCodeForClaim, insertManualCode, takeManualCode } from './repo';

export const DEFAULT_PROGRAM = 'reception-ride-home';
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{2,62}[A-Za-z0-9]$/;

/**
 * DB-backed `ManualCodeSource` for TRANSPORT_BENEFIT_MODE=manual-code. Codes are sealed at rest;
 * `takeNext` is idempotent per claim (a retry gets the same code) and atomic under concurrency.
 */
export class DbManualCodeSource implements ManualCodeSource {
  constructor(private readonly deps: { db?: Db; vault?: Vault } = {}) {}
  private async db() {
    return this.deps.db ?? getDb();
  }
  private async vault() {
    return this.deps.vault ?? getTransportVault();
  }
  async takeNext(claimId: string, req?: { program?: string }) {
    const db = await this.db();
    const vault = await this.vault();
    const existing = await getManualCodeForClaim(db, claimId);
    const row = existing ?? (await takeManualCode(db, req?.program ?? DEFAULT_PROGRAM, claimId));
    if (!row) return null;
    const code = vault.unseal(row.codeCiphertext);
    return code.ok ? code.value : null;
  }
  async lookup(providerRef: string) {
    return this.takeNext(providerRef.replace(/^manual:/, ''));
  }
}

export interface UploadCodesResult {
  added: number;
  duplicates: number;
  rejected: number;
}

/** Admin upload: seals each well-formed code; duplicates (same programme + code) are no-ops. Never returns codes. */
export async function uploadManualCodes(db: Db, vault: Vault, input: { program: string; codes: string[]; uploadedBy: PrincipalRef }, now: Date = new Date()): Promise<UploadCodesResult> {
  let added = 0;
  let duplicates = 0;
  let rejected = 0;
  const seen = new Set<string>();
  for (const raw of input.codes) {
    const code = raw.trim();
    if (!CODE_PATTERN.test(code)) {
      rejected++;
      continue;
    }
    const codeHash = vault.fingerprint(`${input.program}\n${code}`);
    if (seen.has(codeHash)) {
      duplicates++;
      continue;
    }
    seen.add(codeHash);
    const inserted = await insertManualCode(db, { program: input.program, codeCiphertext: vault.seal(code), codeKeyId: vault.keyId, codeHash, uploadedBy: input.uploadedBy }, now);
    if (inserted) added++;
    else duplicates++;
  }
  return { added, duplicates, rejected };
}

let installed = false;
/** Called once at app boot (from the capability aggregate) so manual-code mode reads the table. */
export function installDbManualCodeSource(): void {
  if (installed) return;
  installed = true;
  installManualCodeSource(new DbManualCodeSource());
}

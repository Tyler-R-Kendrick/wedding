import type { ConfigValidation, ProviderFailure } from '@/contracts/providers';
import { err, type Result } from '@/contracts/result';
import { failure, unconfiguredHealth } from '../base';
import type { GuestSheetProvider, GuestSheetSnapshot } from './types';

/**
 * What production gets until the sheet is connected, and what any deployment gets when only some of
 * the variables are set: an honest "not connected" instead of the mock's sample households, which on
 * a real console would read as a real guest list.
 */
export class UnconfiguredGuestSheet implements GuestSheetProvider {
  readonly kind = 'guest-sheet' as const;
  readonly name = 'unconfigured';
  readonly mode = 'unavailable' as const;
  readonly capabilities = { read: false };
  readonly sheetUrl = null;
  constructor(
    private readonly missing: string[],
    private readonly reason = 'the planning sheet is not connected',
  ) {}
  validateConfig(): ConfigValidation {
    return { ok: false, missing: this.missing, warnings: [this.reason] };
  }
  async health() {
    return unconfiguredHealth(this.reason);
  }
  async read(): Promise<Result<GuestSheetSnapshot, ProviderFailure>> {
    const what = this.missing.length ? ` Missing: ${this.missing.join(', ')}.` : '';
    return err(failure(this.name, 'unconfigured', `The planning sheet isn't connected yet.${what}`));
  }
}

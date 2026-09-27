import { SOURCE_KEYS } from '@/content/sources';
import type { PillTone } from '../../_components/console';

/** DESIGN.md freshness tones, mapped onto the console's pill tones. */
export const FRESHNESS_TONE: Record<string, PillTone> = { bad: 'bad', warn: 'warn', ok: 'good' };

/** Where a new record starts: a private draft from the couple's brief, until someone says otherwise. */
export const NEW_RECORD_DEFAULTS: Record<string, string> = {
  sourceId: SOURCE_KEYS.brief,
  sourceType: 'authored',
  trustClass: 'TRUSTED_WEDDING',
  visibility: 'private-draft',
};

import { ok } from '@/contracts/result';
import { okConfig, seededRandom, upHealth } from '../base';
import type { MediaAiProvider, MediaAiVenueClass, MediaAnnotation, MediaRef } from './types';

const SUBJECTS = ['two people laughing', 'a group at a long table', 'a quiet hallway', 'dancers under warm light', 'a bouquet on marble', 'friends on a rooftop', 'a child drawing', 'a toast being raised'];
const SETTINGS = ['in a historic ballroom', 'by tall arched windows', 'on a city street at dusk', 'in a garden', 'near a stained-glass window', 'on a lakefront', 'in a wood-panelled room', 'under string lights'];
const TAGS = ['ceremony', 'reception', 'dancing', 'portrait', 'candid', 'architecture', 'food', 'family', 'friends', 'detail', 'outdoor', 'indoor', 'evening', 'daytime', 'group', 'flowers'];

/** The mock's settings map onto venue classes so classification is exercised end to end. */
const VENUE_FOR_SETTING: Record<string, MediaAiVenueClass> = {
  'in a historic ballroom': 'ballroom',
  'by tall arched windows': 'indoor',
  'on a city street at dusk': 'street',
  'in a garden': 'garden',
  'near a stained-glass window': 'indoor',
  'on a lakefront': 'lakefront',
  'in a wood-panelled room': 'indoor',
  'under string lights': 'outdoor',
};

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}

/** Deterministic captions from the object key hash so tests and fixtures are stable. */
export class MockMediaAi implements MediaAiProvider {
  readonly kind = 'media-ai' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { caption: true, describeScenes: true, tags: true, annotate: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async caption(media: MediaRef) {
    const rand = seededRandom(media.objectKey);
    return ok({ caption: `${pick(rand, SUBJECTS)} ${pick(rand, SETTINGS)}`, confidence: 0.5 + rand() * 0.4, model: 'mock-caption-1' });
  }
  async describeScenes(media: MediaRef, opts: { maxScenes?: number } = {}) {
    const rand = seededRandom(`scenes:${media.objectKey}`);
    const n = Math.min(opts.maxScenes ?? 3, 1 + Math.floor(rand() * 4));
    const scenes = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const len = 5 + Math.floor(rand() * 20);
      scenes.push({ start: t, end: t + len, description: `${pick(rand, SUBJECTS)} ${pick(rand, SETTINGS)}` });
      t += len;
    }
    return ok(scenes);
  }
  async tags(media: MediaRef, opts: { max?: number } = {}) {
    const rand = seededRandom(`tags:${media.objectKey}`);
    const out = new Set<string>();
    const n = Math.min(opts.max ?? 4, 2 + Math.floor(rand() * 4));
    while (out.size < n) out.add(pick(rand, TAGS));
    return ok([...out]);
  }
  async annotate(media: MediaRef) {
    const rand = seededRandom(media.objectKey);
    const subject = pick(rand, SUBJECTS);
    const setting = pick(rand, SETTINGS);
    const confidence = 0.5 + rand() * 0.4;
    const tags = await this.tags(media);
    const annotation: MediaAnnotation = {
      caption: `${subject} ${setting}`,
      altText: `${subject[0]!.toUpperCase()}${subject.slice(1)} ${setting}.`,
      tags: tags.ok ? tags.value : [],
      venueClass: VENUE_FOR_SETTING[setting] ?? 'unknown',
      confidence,
      model: 'mock-caption-1',
    };
    return ok(annotation);
  }
}

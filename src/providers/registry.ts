import type { ProviderDescriptor, ProviderKind, ProviderMode } from '@/contracts/providers';
import type { Db } from '@/db/client';
import { env } from '@/lib/env';
import { isEnabled } from '@/lib/flags';
import { logger } from '@/lib/logger';
import type { AiModelProvider } from './ai-model/types';
import { createAiModelProvider } from './ai-model';
import type { AuthEmailProvider } from './auth-email/types';
import { createAuthEmailProvider } from './auth-email';
import type { BiometricProvider } from './biometric/types';
import { createBiometricProvider } from './biometric';
import type { CashFundProvider, RegistryProvider } from './registry/types';
import { createCashFundProvider } from './cash-fund';
import { createRegistryProvider } from './registry/index';
import type { EmbeddingsProvider } from './embeddings/types';
import { createEmbeddingsProvider } from './embeddings';
import type { FlightsProvider } from './flights/types';
import { createFlightsProvider } from './flights';
import type { HotelsProvider } from './hotels/types';
import { createHotelsProvider } from './hotels';
import type { JobsProvider } from './jobs/types';
import { createJobsProvider } from './jobs';
import type { MapsProvider } from './maps/types';
import { createMapsProvider } from './maps';
import type { MediaAiProvider } from './media-ai/types';
import { createMediaAiProvider } from './media-ai';
import type { RateLimitProvider } from './rate-limit/types';
import { createRateLimitProvider } from './rate-limit';
import type { ReservationsProvider } from './reservations/types';
import { createReservationsProvider } from './reservations';
import type { StorageProvider } from './storage/types';
import { createStorageProvider } from './storage';
import type { TransportBenefitProvider } from './transport-benefit/types';
import { createTransportBenefitProvider } from './transport-benefit';
import type { VectorIndexProvider } from './vector-index/types';
import { createVectorIndexProvider } from './vector-index';
import type { VideoProvider } from './video/types';
import { createVideoProvider } from './video';

/** Typed map from provider kind to its interface. */
export interface ProviderMap {
  'auth-email': AuthEmailProvider;
  storage: StorageProvider;
  video: VideoProvider;
  'media-ai': MediaAiProvider;
  embeddings: EmbeddingsProvider;
  'vector-index': VectorIndexProvider;
  biometric: BiometricProvider;
  'ai-model': AiModelProvider;
  flights: FlightsProvider;
  hotels: HotelsProvider;
  'transport-benefit': TransportBenefitProvider;
  registry: RegistryProvider;
  'cash-fund': CashFundProvider;
  reservations: ReservationsProvider;
  maps: MapsProvider;
  'rate-limit': RateLimitProvider;
  jobs: JobsProvider;
}

type Factories = { [K in ProviderKind]: (deps: RegistryDeps) => ProviderMap[K] };

export interface RegistryDeps {
  /** Present once the database has connected; DB-backed providers fall back to memory without it. */
  db?: Db;
}

const factories: Factories = {
  'auth-email': () => createAuthEmailProvider(env),
  storage: () => createStorageProvider(env, { warn: (m) => logger.warn(m) }),
  video: (d) => createVideoProvider({ storage: resolve('storage', d) }),
  'media-ai': () => createMediaAiProvider(),
  embeddings: () => createEmbeddingsProvider(env),
  'vector-index': (d) => createVectorIndexProvider({ dims: resolve('embeddings', d).dims, db: d.db, forceMock: env.FORCE_MOCK_PROVIDERS }),
  biometric: (d) => createBiometricProvider({ readiness: () => isEnabled('BIOMETRICS_ENABLED', { db: d.db }) }),
  'ai-model': () => createAiModelProvider(env),
  flights: () => createFlightsProvider(env),
  hotels: () => createHotelsProvider(env),
  'transport-benefit': () => createTransportBenefitProvider(env),
  registry: () => createRegistryProvider(env),
  'cash-fund': () => createCashFundProvider(env),
  reservations: () => createReservationsProvider(),
  maps: () => createMapsProvider(),
  'rate-limit': (d) => createRateLimitProvider(env, { db: d.db }),
  jobs: (d) => {
    if (!d.db) throw new Error('jobs provider requires a database; call getProvider("jobs", { db })');
    return createJobsProvider({ db: d.db });
  },
};

type Cache = Partial<{ [K in ProviderKind]: ProviderMap[K] }>;
const g = globalThis as unknown as { __weddingProviders?: Cache; __weddingProviderOverrides?: Cache };
const cache = (): Cache => (g.__weddingProviders ??= {});
const overrides = (): Cache => (g.__weddingProviderOverrides ??= {});

function resolve<K extends ProviderKind>(kind: K, deps: RegistryDeps): ProviderMap[K] {
  const o = overrides()[kind];
  if (o) return o as ProviderMap[K];
  const c = cache();
  const hit = c[kind];
  if (hit) return hit as ProviderMap[K];
  const built = factories[kind](deps) as ProviderMap[K];
  // DB-backed kinds are only cached once the db is present, so an early call does not pin the fallback.
  const needsDb = kind === 'vector-index' || kind === 'rate-limit' || kind === 'jobs' || kind === 'biometric';
  if (!needsDb || deps.db) (c as Record<string, unknown>)[kind] = built;
  return built;
}

/**
 * Typed provider lookup. Mode selection happens in each kind's `index.ts` from `env`;
 * every kind resolves to its mock when unconfigured, and FORCE_MOCK_PROVIDERS=1 forces mocks.
 */
export function getProvider<K extends ProviderKind>(kind: K, deps: RegistryDeps = {}): ProviderMap[K] {
  return resolve(kind, deps);
}

/** Tests: replace a provider for the rest of the process. */
export function setProviderOverride<K extends ProviderKind>(kind: K, instance: ProviderMap[K] | undefined): void {
  if (instance) (overrides() as Record<string, unknown>)[kind] = instance;
  else delete overrides()[kind];
}

export function resetProviders(): void {
  g.__weddingProviders = {};
  g.__weddingProviderOverrides = {};
}

export interface ProviderStatus {
  kind: ProviderKind;
  name: string;
  mode: ProviderMode;
  config: { ok: boolean; missing: string[]; warnings: string[] };
}

/** Modes for /api/health and the admin integrations page. Never includes values. */
export function describeProviders(deps: RegistryDeps = {}): ProviderStatus[] {
  const kinds = Object.keys(factories) as ProviderKind[];
  return kinds.map((kind) => {
    try {
      const p: ProviderDescriptor = resolve(kind, deps);
      return { kind, name: p.name, mode: p.mode, config: p.validateConfig() };
    } catch (e) {
      return { kind, name: 'unavailable', mode: 'unavailable', config: { ok: false, missing: [], warnings: [e instanceof Error ? e.message : 'error'] } };
    }
  });
}

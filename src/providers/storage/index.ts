import path from 'node:path';
import type { ServerEnv } from '@/lib/env';
import { publicEnv } from '@/lib/env.public';
import { LocalFsStorage } from './local-fs';
import { S3Storage } from './s3';
import type { StorageProvider } from './types';

export * from './types';
export { LocalFsStorage, signDevStorage, verifyDevStorage, type DevStorageSignatureInput } from './local-fs';
export { S3Storage } from './s3';

export const DEV_STORAGE_SIGNING_SECRET = 'dev-only-storage-signing-secret-change-me';

type StorageEnv = Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE' | 'STORAGE_DATA_DIR' | 'STORAGE_SIGNING_SECRET' | 'isProduction'>;

export function createStorageProvider(env: StorageEnv, opts: { baseUrl?: string; warn?: (msg: string) => void } = {}): StorageProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return new S3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  if (env.isProduction && !env.STORAGE_SIGNING_SECRET) {
    opts.warn?.('STORAGE_SIGNING_SECRET is not set; local-fs signed URLs use the dev default');
  }
  return new LocalFsStorage({
    dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), env.STORAGE_DATA_DIR),
    baseUrl: opts.baseUrl ?? publicEnv.siteUrl,
    signingSecret: env.STORAGE_SIGNING_SECRET ?? DEV_STORAGE_SIGNING_SECRET,
  });
}

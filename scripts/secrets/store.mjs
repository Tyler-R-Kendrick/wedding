/**
 * Where the Secret Drop keeps its working state.
 *
 * One place, because `serve.mjs --secrets <dir>` is a promise about the whole toolchain and not
 * just the server: it spawns the ladder to do the work the page asks for, and while every other
 * script hard-coded `.secrets/` those runs read and wrote the developer's real store no matter
 * what the server had been pointed at. A verification that mutates the state it is supposed to be
 * isolated from is not a verification.
 *
 * `SECRETS_DIR` is set by whoever spawns the process; unset, it is the ordinary `.secrets/`.
 */
import { join, resolve } from 'node:path';

export const STORE = process.env.SECRETS_DIR || '.secrets';

/** A path inside the store. Absolute stores are honoured as given, never pasted onto the cwd. */
export const inStore = (...parts) => (STORE.startsWith('/') ? resolve(STORE, ...parts) : join(STORE, ...parts));

/**
 * Which `.env` the ladder writes. Same reasoning as the store: a run spawned by a server that was
 * pointed elsewhere must not append to the developer's real environment file.
 */
export const ENV_PATH = process.env.SECRET_DROP_ENV || '.env';

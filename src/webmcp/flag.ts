import { readFlags } from '@/contracts/flags';

/** Server-side: mount the bridge island only when `FLAG_WEBMCP` (default on) is set. Dependency-free. */
export const isWebMcpEnabled = (source: Record<string, string | undefined> = process.env): boolean => readFlags(source).WEBMCP;

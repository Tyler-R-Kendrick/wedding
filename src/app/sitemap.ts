import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env.public';
import { publicSitemapPaths } from '@/lib/site-inventory';

/**
 * Public URL list for search engines. Audience `public` only, from `publicSitemapPaths()`.
 * Lifecycle `visibleFrom` is not applied: it decides when a page joins the navigation, not whether
 * the route exists. Guest, gate, admin, internal, API and redirect URLs are omitted.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicEnv.siteUrl;
  return publicSitemapPaths().map((path) => ({ url: new URL(path, origin).href }));
}

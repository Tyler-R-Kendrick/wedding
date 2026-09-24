import type { MetadataRoute } from 'next';
import { robotsRules } from '@/lib/rights';

/** AI crawlers are refused the whole site, and every crawler the couple's photos (src/lib/rights.ts). */
export default function robots(): MetadataRoute.Robots {
  return robotsRules();
}

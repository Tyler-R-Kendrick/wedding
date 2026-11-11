import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { inventoryMarkdown } from '@/lib/site-inventory';

const out = path.resolve('docs/sitemap.md');
writeFileSync(out, inventoryMarkdown());
console.log(`wrote ${out}`);

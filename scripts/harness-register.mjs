// node --import ./scripts/harness-register.mjs --import tsx scripts/render-home.tsx
// Registers loader hooks that stub Next-only modules so the theme kits render outside Next.js.
import { register } from 'node:module';
register('./harness-hooks.mjs', import.meta.url);

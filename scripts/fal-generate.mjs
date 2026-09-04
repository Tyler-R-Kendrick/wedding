#!/usr/bin/env node
// Quick fal.ai image generation for mood boards and comps.
//   FAL_KEY=... node scripts/fal-generate.mjs "editorial wedding invitation on warm ivory paper, letterpress, terracotta wax seal"
//   Options: --model fal-ai/flux-pro/v1.1-ultra  --size 1024x1536  --out .impeccable/review/moodboard.png
// Output is written locally and is for direction/placeholders only — never shipped as a "photo of the couple".
import { fal } from '@fal-ai/client';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const prompt = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))).join(' ').trim();
const model = opt('model', 'fal-ai/flux-pro/v1.1');
const [w, h] = opt('size', '1024x1280').split('x').map(Number);
const out = opt('out', `.impeccable/review/fal-${Date.now()}.png`);

if (!process.env.FAL_KEY) {
  console.error('FAL_KEY is not set. Get one at https://fal.ai/dashboard/keys and put it in .env (see .env.example).');
  process.exit(2);
}
if (!prompt) {
  console.error('Usage: node scripts/fal-generate.mjs "<prompt>" [--model id] [--size WxH] [--out path]');
  process.exit(2);
}

fal.config({ credentials: process.env.FAL_KEY });
const result = await fal.subscribe(model, {
  input: { prompt, image_size: { width: w, height: h }, num_images: 1 },
  logs: false,
});
const image = result.data?.images?.[0];
if (!image?.url) { console.error('No image returned:', JSON.stringify(result.data).slice(0, 300)); process.exit(1); }
const buf = Buffer.from(await (await fetch(image.url)).arrayBuffer());
await mkdir(dirname(out), { recursive: true });
await writeFile(out, buf);
console.log(`${out}  (${model}, ${w}x${h}, request ${result.requestId})`);

import { readFile } from 'node:fs/promises';

// These are explicit fixture checks, not a substitute for a product-native detector.
const html = await readFile(new URL('./good.html', import.meta.url), 'utf8');
if (process.argv[2] === 'build') {
  if (!html.startsWith('<!doctype html>')) process.exitCode = 1;
} else if (process.argv[2] === 'detect') {
  if (!html.includes('<html lang="en">') || !html.includes('<main>')) process.exitCode = 1;
} else {
  process.exitCode = 1;
}

import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/@spotify/basic-pitch/model');
const dest = resolve(root, 'public/model');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('Basic Pitch model copied to public/model');

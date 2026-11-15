// Writes src/version.js: build number = number of the commit about to be made, plus the current time.
// Run it just before each commit: node scripts/stamp-version.js   (npm run stamp)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/version.js', import.meta.url);
let number = 1;
try { number = Number(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()) + 1; } catch { /* first commit */ }

const stamp = `export const BUILD = { number: ${number}, at: '${new Date().toISOString()}' };`;
const src = readFileSync(file, 'utf8').replace(/^export const BUILD = .*;$/m, stamp);
writeFileSync(file, src);
console.log(`version.js : ${stamp}`);

export { encodeRowerData as buildRowerFrame } from '../src/ftms-encoder.js';

export function fromHex(hex) {
  const clean = hex.replace(/\s+/g, '');
  return new Uint8Array(clean.match(/../g).map((b) => parseInt(b, 16)));
}

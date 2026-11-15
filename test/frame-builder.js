// Test helper (future base of sim.js): builds a Rower Data frame from a plain object of fields.
// Flags are computed from the keys provided. null => the field's sentinel ("no data").
import { ROWER_DATA_BLOCKS, FIELD_TYPES } from '../src/ftms.js';

export function buildRowerFrame(values) {
  let flags = 0;
  const present = [];
  for (const block of ROWER_DATA_BLOCKS) {
    const has = block.fields.some((f) => f.key in values);
    if (block.inverted ? !has : has) flags |= 1 << block.bit;
    if (has) present.push(block);
  }

  const size = 2 + present.reduce((n, b) => n + b.fields.reduce((m, f) => m + FIELD_TYPES[f.type].size, 0), 0);
  const view = new DataView(new ArrayBuffer(size));
  view.setUint16(0, flags, true);

  let offset = 2;
  for (const block of present) {
    for (const f of block.fields) {
      const v = values[f.key];
      const raw = v === null ? f.sentinel : Math.round((v ?? 0) * (f.div ?? 1));
      FIELD_TYPES[f.type].write(view, offset, raw);
      offset += FIELD_TYPES[f.type].size;
    }
  }
  return view;
}

export function fromHex(hex) {
  const clean = hex.replace(/\s+/g, '');
  return new Uint8Array(clean.match(/../g).map((b) => parseInt(b, 16)));
}

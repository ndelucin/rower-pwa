// Rower Data (0x2AD1) ENCODER: the reverse of ftms.js. Used by the simulator and the tests.
// Flags are computed from the keys provided. null => the field's sentinel ("no data").
import { ROWER_DATA_BLOCKS, FIELD_TYPES } from './ftms.js';

const blockSize = (block) => block.fields.reduce((n, f) => n + FIELD_TYPES[f.type].size, 0);
const hasAny = (block, values) => block.fields.some((f) => f.key in values);

export function encodeRowerData(values) {
  let flags = 0;
  const present = [];
  for (const block of ROWER_DATA_BLOCKS) {
    const has = hasAny(block, values);
    if (block.inverted ? !has : has) flags |= 1 << block.bit;
    if (has) present.push(block);
  }

  const view = new DataView(new ArrayBuffer(2 + present.reduce((n, b) => n + blockSize(b), 0)));
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

/**
 * Splits one set of values into several fragments that each encode to at most `maxBytes`
 * (20 = BLE payload with the default MTU of 23). Mimics what a module does with the More Data bit:
 * every fragment but the last has bit 0 = 1 (no stroke fields); stroke rate/count travel in the last one.
 */
export function splitRowerData(values, maxBytes = 20) {
  const pick = (block) => Object.fromEntries(
    block.fields.filter((f) => f.key in values).map((f) => [f.key, values[f.key]]),
  );
  const frames = [];
  let current = {};
  let size = 2; // flags

  const add = (block) => {
    const s = blockSize(block);
    if (size + s > maxBytes && Object.keys(current).length) {
      frames.push(current);
      current = {};
      size = 2;
    }
    Object.assign(current, pick(block));
    size += s;
  };

  for (const block of ROWER_DATA_BLOCKS) if (!block.inverted && hasAny(block, values)) add(block);
  const stroke = ROWER_DATA_BLOCKS.find((b) => b.inverted);
  if (hasAny(stroke, values)) add(stroke);
  frames.push(current);
  return frames;
}

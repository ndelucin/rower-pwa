// FTMS (Fitness Machine Service 0x1826) decoder — Rower Data characteristic 0x2AD1.
// Pure module: no DOM, no Web Bluetooth. Input is a DataView (or ArrayBuffer / typed array).
//
// Frame layout (little-endian): uint16 flags, then each block whose flag bit says "present",
// in ascending bit order. Bit 0 ("More Data") is inverted: 0 means Stroke Rate + Stroke Count ARE present.

const TYPES = {
  u8: { size: 1, read: (v, o) => v.getUint8(o), write: (v, o, x) => v.setUint8(o, x) },
  u16: { size: 2, read: (v, o) => v.getUint16(o, true), write: (v, o, x) => v.setUint16(o, x, true) },
  u24: {
    size: 3,
    read: (v, o) => v.getUint16(o, true) | (v.getUint8(o + 2) << 16),
    write: (v, o, x) => { v.setUint16(o, x & 0xffff, true); v.setUint8(o + 2, (x >>> 16) & 0xff); },
  },
  s16: { size: 2, read: (v, o) => v.getInt16(o, true), write: (v, o, x) => v.setInt16(o, x, true) },
};

// Declarative description of Rower Data (FTMS 1.0, § 4.8).
// div: raw value is divided by this (0.5 resolution => div 2). sentinel: raw value meaning "no data" => null.
export const ROWER_DATA_BLOCKS = [
  { bit: 0, inverted: true, fields: [
    { key: 'strokeRate', type: 'u8', div: 2 },
    { key: 'strokeCount', type: 'u16' },
  ] },
  { bit: 1, fields: [{ key: 'avgStrokeRate', type: 'u8', div: 2 }] },
  { bit: 2, fields: [{ key: 'totalDistance', type: 'u24' }] },
  { bit: 3, fields: [{ key: 'instPace', type: 'u16', sentinel: 0xffff }] },
  { bit: 4, fields: [{ key: 'avgPace', type: 'u16', sentinel: 0xffff }] },
  { bit: 5, fields: [{ key: 'instPower', type: 's16', sentinel: 0x7fff }] },
  { bit: 6, fields: [{ key: 'avgPower', type: 's16', sentinel: 0x7fff }] },
  { bit: 7, fields: [{ key: 'resistance', type: 's16' }] },
  { bit: 8, fields: [
    { key: 'totalEnergy', type: 'u16', sentinel: 0xffff },
    { key: 'energyPerHour', type: 'u16', sentinel: 0xffff },
    { key: 'energyPerMinute', type: 'u8', sentinel: 0xff },
  ] },
  { bit: 9, fields: [{ key: 'heartRate', type: 'u8' }] },
  { bit: 10, fields: [{ key: 'met', type: 'u8', div: 10 }] },
  { bit: 11, fields: [{ key: 'elapsedTime', type: 'u16' }] },
  { bit: 12, fields: [{ key: 'remainingTime', type: 'u16' }] },
];

export { TYPES as FIELD_TYPES };

export function isBlockPresent(block, flags) {
  const set = (flags & (1 << block.bit)) !== 0;
  return block.inverted ? !set : set;
}

function toDataView(input) {
  if (input instanceof DataView) return input;
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) return new DataView(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('parseRowerData expects a DataView, ArrayBuffer or typed array');
}

/**
 * Decode one Rower Data notification.
 * Returns { flags, moreData, fields, truncated }. `fields` only contains the fields present in this frame;
 * a field whose raw value is its sentinel is present with value null ("no data", display "--").
 * Never throws on a short frame: complete fields already read are kept and `truncated` is true.
 */
export function parseRowerData(input) {
  const view = toDataView(input);
  if (view.byteLength < 2) return { flags: null, moreData: false, fields: {}, truncated: true };

  const flags = view.getUint16(0, true);
  const fields = {};
  let offset = 2;

  for (const block of ROWER_DATA_BLOCKS) {
    if (!isBlockPresent(block, flags)) continue;
    for (const f of block.fields) {
      const t = TYPES[f.type];
      if (offset + t.size > view.byteLength) {
        return { flags, moreData: (flags & 1) !== 0, fields, truncated: true };
      }
      const raw = t.read(view, offset);
      offset += t.size;
      fields[f.key] = raw === f.sentinel ? null : (f.div ? raw / f.div : raw);
    }
  }
  return { flags, moreData: (flags & 1) !== 0, fields, truncated: false };
}

/**
 * Merges fragments into a complete, up-to-date picture of the machine.
 * Needed when a full frame (27 bytes with flags 0x0BFE) does not fit in one notification
 * and the module splits it using the More Data bit.
 */
export function createRowerState() {
  let state = {};
  return {
    apply(parsed) {
      state = { ...state, ...(parsed.fields ?? parsed) };
      return this.snapshot();
    },
    snapshot() {
      return { ...state };
    },
    reset() {
      state = {};
    },
  };
}

/** 278 -> "4:38" ; null / undefined -> "--" */
export function formatPace(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

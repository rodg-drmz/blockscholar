const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) chk ^= GENERATORS[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const chars = [...hrp].map((c) => c.charCodeAt(0));
  return [...chars.map((c) => c >> 5), 0, ...chars.map((c) => c & 31)];
}

function createChecksum(hrp: string, data: number[]): number[] {
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  return Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
}

function convertBits(data: Uint8Array, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length < 56 || clean.length % 2 !== 0) {
    throw new Error('Unsupported address format');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return unwrapCborBytes(bytes);
}

/** CIP-30 sometimes wraps address bytes in a CBOR byte string. */
function unwrapCborBytes(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x58 && bytes.length > 2 && bytes[1] + 2 === bytes.length) {
    return bytes.subarray(2);
  }
  if (bytes[0] === 0x59 && bytes.length > 3) {
    const len = (bytes[1] << 8) | bytes[2];
    if (len + 3 === bytes.length) return bytes.subarray(3);
  }
  return bytes;
}

function hrpForAddress(bytes: Uint8Array): string {
  const header = bytes[0] ?? 0;
  const type = header >> 4;
  const network = header & 0x0f;
  const mainnet = network === 1;
  const stake = type === 14 || type === 15;
  if (stake) return mainnet ? 'stake' : 'stake_test';
  return mainnet ? 'addr' : 'addr_test';
}

export function isCardanoBech32(value: string): boolean {
  return /^(addr1|addr_test1|stake1|stake_test1)/i.test(value.trim());
}

/** Decode CIP-30 hex (or pass through bech32) without Mesh WASM. */
export function cardanoAddressToBech32(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error('Wallet did not return an address.');
  if (isCardanoBech32(value)) return value;

  const bytes = hexToBytes(value);
  if (bytes.length < 29) throw new Error('Unsupported address format');

  const hrp = hrpForAddress(bytes);
  const words = convertBits(bytes, 8, 5, true);
  const combined = [...words, ...createChecksum(hrp, words)];
  return `${hrp}1${combined.map((word) => CHARSET[word]).join('')}`;
}

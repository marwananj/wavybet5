import crypto from 'crypto';

/**
 * Provably fair RNG (industry-standard HMAC scheme).
 * Each round is determined by: HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`).
 * Every 32-byte digest yields 8 floats in [0, 1), 4 bytes each.
 * The server seed is secret while in use; players see its SHA-256 hash and can verify every
 * past round once they rotate their seed pair (which reveals the old server seed).
 */
export const newServerSeed = () => crypto.randomBytes(32).toString('hex');
export const newClientSeed = () => crypto.randomBytes(10).toString('hex');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface Seeds {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

export type Rng = (i: number) => number;

export function makeRng(s: Seeds): Rng {
  const blocks = new Map<number, Buffer>();
  return (i: number) => {
    const cursor = Math.floor(i / 8);
    let h = blocks.get(cursor);
    if (!h) {
      h = crypto.createHmac('sha256', s.serverSeed).update(`${s.clientSeed}:${s.nonce}:${cursor}`).digest();
      blocks.set(cursor, h);
    }
    const off = (i % 8) * 4;
    let f = 0;
    for (let k = 0; k < 4; k++) f += h[off + k] / 256 ** (k + 1);
    return f;
  };
}

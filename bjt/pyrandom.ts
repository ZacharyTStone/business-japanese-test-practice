/**
 * Python's `random.Random`, draw for draw.
 *
 * A seeded shuffle decides the order of a question's four options
 * (`Generator._finalize`), which seed cells a batch takes
 * (`SeedTable.pick`), and the order the discriminator sees its items in.
 * The tests seed those and the outputs they check were Python's, so this is
 * CPython's Mersenne Twister (MT19937) with its seeding, `random()`,
 * `getrandbits()` and `_randbelow` exactly as `Modules/_randommodule.c` and
 * `Lib/random.py` have them. Unseeded (`new Random()`), it seeds itself from
 * the operating system, as Python does.
 */
import { randomBytes } from "node:crypto";

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class Random {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number | bigint | null = null) {
    this.seed(seed);
  }

  /** `random.seed(a)`: an int seeds from its absolute value's 32-bit words;
   *  None seeds from the operating system. */
  seed(a: number | bigint | null = null): void {
    if (a === null || a === undefined) {
      const bytes = randomBytes(N * 4);
      const key: number[] = [];
      for (let i = 0; i < N; i++) key.push(bytes.readUInt32LE(i * 4));
      this.initByArray(key);
      return;
    }
    let n = typeof a === "bigint" ? a : BigInt(Math.trunc(a));
    if (n < 0n) n = -n;
    const key: number[] = [];
    if (n === 0n) key.push(0);
    while (n > 0n) {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    }
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      // 1812433253 * prev + i, in 32 bits.
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    const keyLength = key.length;
    for (let k = Math.max(N, keyLength); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= keyLength) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  /** One 32-bit word (`genrand_uint32`). */
  private next32(): number {
    const mt = this.mt;
    let y: number;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      y = (mt[N - 1] & UPPER_MASK) | (mt[0] & LOWER_MASK);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** `random()`: a float in [0, 1) with 53 random bits. */
  random(): number {
    const a = this.next32() >>> 5;
    const b = this.next32() >>> 6;
    return (a * 67108864 + b) * (1.0 / 9007199254740992);
  }

  /** `getrandbits(k)` for k ≤ 53, as a number. */
  getrandbits(k: number): number {
    if (k < 0) throw new RangeError("number of bits must be non-negative");
    if (k === 0) return 0;
    if (k <= 32) return this.next32() >>> (32 - k);
    // Little-endian 32-bit words, the last one shifted down to what is left.
    let result = 0n;
    let shift = 0n;
    let left = k;
    while (left > 0) {
      let r = this.next32();
      if (left < 32) r >>>= 32 - left;
      result |= BigInt(r) << shift;
      shift += 32n;
      left -= 32;
    }
    return Number(result);
  }

  /** `_randbelow(n)`: uniform in [0, n), by rejection on `n.bit_length()`
   *  bits. */
  randbelow(n: number): number {
    if (n <= 0) return 0;
    const k = n.toString(2).length;
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** `shuffle(x)`, in place. */
  shuffle<T>(x: T[]): void {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const t = x[i];
      x[i] = x[j];
      x[j] = t;
    }
  }

  /** `choice(seq)`. */
  choice<T>(seq: readonly T[]): T {
    if (seq.length === 0) throw new RangeError("Cannot choose from an empty sequence");
    return seq[this.randbelow(seq.length)];
  }

  /** `randrange(start, stop)` / `randrange(stop)`, step 1. */
  randrange(start: number, stop?: number): number {
    if (stop === undefined) {
      if (start <= 0) throw new RangeError("empty range for randrange()");
      return this.randbelow(start);
    }
    const width = stop - start;
    if (width <= 0) throw new RangeError("empty range for randrange()");
    return start + this.randbelow(width);
  }

  /** `randint(a, b)`: both ends included. */
  randint(a: number, b: number): number {
    return this.randrange(a, b + 1);
  }

  /** `uniform(a, b)`. */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** `sample(population, k)`, Python's algorithm (set-based selection for a
   *  large population, a partial shuffle otherwise). */
  sample<T>(population: readonly T[], k: number): T[] {
    const n = population.length;
    if (k < 0 || k > n) throw new RangeError("Sample larger than population or is negative");
    const result: T[] = new Array(k);
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n <= setsize) {
      const pool = [...population];
      for (let i = 0; i < k; i++) {
        const j = this.randbelow(n - i);
        result[i] = pool[j];
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = new Set<number>();
      for (let i = 0; i < k; i++) {
        let j = this.randbelow(n);
        while (selected.has(j)) j = this.randbelow(n);
        selected.add(j);
        result[i] = population[j];
      }
    }
    return result;
  }
}

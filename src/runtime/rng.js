/**
 * @file Story RNG (SPEC §9): mulberry32 with a mutable 32-bit word as the
 * serializable state. All randomness in stories flows through here so that
 * replaying choices from a save reproduces identical draws.
 *
 * @typedef {object} Rng
 * @property {() => number} next       uniform float in [0, 1)
 * @property {(lo: number, hi: number) => number} int  uniform integer, inclusive both ends
 * @property {<T>(list: T[]) => T} pick  uniform element of a non-empty list
 * @property {() => number} getWord    current 32-bit state word (uint32)
 * @property {(w: number) => void} setWord  restore a previously saved word
 */

/**
 * Creates a mulberry32 generator seeded with the low 32 bits of `seed`.
 * @param {number} seed initial state word
 * @returns {Rng}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;

  function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(lo, hi) {
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  return {
    next,
    int,
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    getWord() {
      return a >>> 0;
    },
    setWord(w) {
      a = w >>> 0;
    },
  };
}

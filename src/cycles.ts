// Where a reward cycle's boundaries fall, and why the stake window is shorter
// than the pool says it is.
//
// Both pages need this while rendering, and rendering happens before the chain
// layer is loaded -- so it lives apart from `chain.ts`, alongside `plain.ts`,
// and pulls in nothing.

/**
 * The reward cycle's shape, as pox-5's `get-pox-info` reports it.
 *
 * pox-5 freezes the next cycle's staker set for the last `prepare` blocks of
 * every cycle: `register-for-bond` runs `verify-not-prepare-phase` before
 * anything else and answers `(err u47)` there. A bond period starts on a cycle
 * boundary, so those blocks are the end of the pool's stake window -- and
 * nothing in the pool's own `get-bound-bond` says so.
 */
export interface PoxCycles {
  /** Burn height of cycle 0, which every boundary is measured from. */
  first: number;
  /** Blocks in a reward cycle. */
  length: number;
  /** Blocks at the end of one in which the set is frozen. */
  prepare: number;
  /** The cycle the chain is in now. */
  cycle: number;
}

/**
 * The stretch of a stake window pox-5 will not take a registration in.
 *
 * `stake` passes every check the *pool* makes and then aborts on this one,
 * which is a bond missed on a technicality nothing on the page mentioned -- so
 * the page has to mention it. A window is shorter than a cycle, so it meets at
 * most one freeze; which cycle's is worked out rather than assumed, and `null`
 * means the window is clear end to end.
 */
export function freezeIn(
  from: number,
  to: number,
  cycles: PoxCycles | null,
): { from: number; to: number } | null {
  if (!cycles || cycles.length <= 0 || to <= from) return null;
  const cycleOf = (height: number) =>
    Math.floor((height - cycles.first) / cycles.length);
  let found: { from: number; to: number } | null = null;
  for (const cycle of new Set([cycleOf(from), cycleOf(to - 1)])) {
    const ends = cycles.first + (cycle + 1) * cycles.length;
    const lo = Math.max(ends - cycles.prepare, from);
    const hi = Math.min(ends, to);
    if (lo < hi && (found === null || lo < found.from)) found = { from: lo, to: hi };
  }
  return found;
}

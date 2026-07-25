import { strictEqual } from 'node:assert/strict';

/** All money math lives here: lamports, prorated by the second against an hourly rate. */

export const cost = (rateLamportsPerHour: bigint, seconds: number): bigint =>
  (rateLamportsPerHour * BigInt(Math.max(0, Math.ceil(seconds)))) / 3600n;

/** What we can actually take: never more than the renter holds. */
export const billable = (rateLamportsPerHour: bigint, seconds: number, balance: bigint): bigint => {
  const c = cost(rateLamportsPerHour, seconds);
  return c > balance ? balance : c;
};

/** Seconds of runway left at this rate — what the countdown in the UI is driven by. */
export const secondsRemaining = (rateLamportsPerHour: bigint, balance: bigint): number =>
  rateLamportsPerHour <= 0n ? Infinity : Number((balance * 3600n) / rateLamportsPerHour);

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rate = 3_600_000n; // 1000 lamports/second
  strictEqual(cost(rate, 0), 0n);
  strictEqual(cost(rate, 1), 1000n);
  strictEqual(cost(rate, 90), 90_000n);
  strictEqual(cost(rate, -5), 0n); // clock skew must never credit anyone
  strictEqual(cost(rate, 0.4), 1000n); // partial seconds round up
  strictEqual(billable(rate, 3600, 500n), 500n); // clamped to balance, no negative ledger
  strictEqual(billable(rate, 10, 10_000_000n), 10_000n);
  strictEqual(secondsRemaining(rate, 10_000n), 10);
  strictEqual(secondsRemaining(0n, 10_000n), Infinity);
  console.log('billing ok');
}

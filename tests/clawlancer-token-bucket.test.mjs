import assert from "node:assert/strict";
import test from "node:test";

import { TokenBucket } from "../examples/clawlancer-token-bucket.mjs";

function fakeClock() {
  let now = 0;
  return {
    clock: () => now,
    advance: (milliseconds) => {
      now += milliseconds;
    },
    rewind: (milliseconds) => {
      now -= milliseconds;
    },
  };
}

test("allows the configured burst and rejects the next token", () => {
  const time = fakeClock();
  const bucket = new TokenBucket({
    capacity: 3,
    refillRatePerSecond: 1,
    clock: time.clock,
  });

  assert.equal(bucket.tryConsume(), true);
  assert.equal(bucket.tryConsume(), true);
  assert.equal(bucket.tryConsume(), true);
  assert.equal(bucket.tryConsume(), false);
  assert.equal(bucket.availableTokens, 0);
});

test("refills tokens at the configured rate", () => {
  const time = fakeClock();
  const bucket = new TokenBucket({
    capacity: 2,
    refillRatePerSecond: 4,
    clock: time.clock,
  });

  assert.equal(bucket.tryConsume(2), true);
  time.advance(250);
  assert.equal(bucket.availableTokens, 1);
  assert.equal(bucket.tryConsume(), true);
  assert.equal(bucket.tryConsume(), false);
});

test("never refills above the burst capacity", () => {
  const time = fakeClock();
  const bucket = new TokenBucket({
    capacity: 5,
    refillRatePerSecond: 10,
    clock: time.clock,
  });

  assert.equal(bucket.tryConsume(4), true);
  time.advance(10_000);
  assert.equal(bucket.availableTokens, 5);
});

test("reports deterministic wait time for a multi-token request", () => {
  const time = fakeClock();
  const bucket = new TokenBucket({
    capacity: 10,
    refillRatePerSecond: 2,
    clock: time.clock,
  });

  assert.equal(bucket.tryConsume(10), true);
  assert.equal(bucket.timeUntilAvailable(3), 1_500);
  assert.equal(bucket.timeUntilAvailable(11), Number.POSITIVE_INFINITY);
  time.advance(1_500);
  assert.equal(bucket.timeUntilAvailable(3), 0);
});

test("rejects invalid configuration and consumption amounts", () => {
  const time = fakeClock();
  assert.throws(
    () => new TokenBucket({ capacity: 0, refillRatePerSecond: 1, clock: time.clock }),
    /capacity/,
  );
  assert.throws(
    () => new TokenBucket({ capacity: 1, refillRatePerSecond: 0, clock: time.clock }),
    /refillRatePerSecond/,
  );

  const bucket = new TokenBucket({ capacity: 1, refillRatePerSecond: 1, clock: time.clock });
  assert.throws(() => bucket.tryConsume(0), /token amount/);
  assert.throws(() => bucket.tryConsume(Number.NaN), /token amount/);
});

test("rejects a clock that moves backwards", () => {
  const time = fakeClock();
  const bucket = new TokenBucket({ capacity: 1, refillRatePerSecond: 1, clock: time.clock });
  time.advance(1);
  assert.equal(bucket.availableTokens, 1);
  time.rewind(2);
  assert.throws(() => bucket.availableTokens, /monotonic/);
});

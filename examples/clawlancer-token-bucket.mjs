/**
 * Dependency-free token-bucket rate limiter with an injectable monotonic clock.
 * Time values returned by `clock` are milliseconds.
 */
export class TokenBucket {
  #capacity;
  #clock;
  #lastRefillMs;
  #refillPerMs;
  #tokens;

  constructor({ capacity, refillRatePerSecond, clock = () => performance.now() }) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive finite number");
    }
    if (!Number.isFinite(refillRatePerSecond) || refillRatePerSecond <= 0) {
      throw new RangeError("refillRatePerSecond must be a positive finite number");
    }
    if (typeof clock !== "function") throw new TypeError("clock must be a function");

    const initialTime = clock();
    if (!Number.isFinite(initialTime)) throw new TypeError("clock must return a finite number");

    this.#capacity = capacity;
    this.#clock = clock;
    this.#lastRefillMs = initialTime;
    this.#refillPerMs = refillRatePerSecond / 1_000;
    this.#tokens = capacity;
  }

  get capacity() {
    return this.#capacity;
  }

  get availableTokens() {
    this.#refill();
    return this.#tokens;
  }

  tryConsume(amount = 1) {
    this.#validateAmount(amount);
    this.#refill();
    if (amount > this.#tokens) return false;
    this.#tokens -= amount;
    return true;
  }

  timeUntilAvailable(amount = 1) {
    this.#validateAmount(amount);
    if (amount > this.#capacity) return Number.POSITIVE_INFINITY;
    this.#refill();
    if (amount <= this.#tokens) return 0;
    return Math.ceil((amount - this.#tokens) / this.#refillPerMs);
  }

  #refill() {
    const now = this.#clock();
    if (!Number.isFinite(now)) throw new TypeError("clock must return a finite number");
    if (now < this.#lastRefillMs) throw new RangeError("clock must be monotonic");

    const elapsedMs = now - this.#lastRefillMs;
    if (elapsedMs > 0) {
      this.#tokens = Math.min(this.#capacity, this.#tokens + elapsedMs * this.#refillPerMs);
      this.#lastRefillMs = now;
    }
  }

  #validateAmount(amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new RangeError("token amount must be a positive finite number");
    }
  }
}

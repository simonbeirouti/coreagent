type TokenBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  public constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  public check(key: string, nowMs = Date.now()): RateLimitDecision {
    const existing = this.buckets.get(key);
    const hasExpired = !existing || existing.resetAt <= nowMs;
    const bucket: TokenBucket = hasExpired
      ? {
          count: 0,
          resetAt: nowMs + this.windowMs
        }
      : existing;

    if (bucket.count >= this.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetSeconds: retryAfterSeconds,
        retryAfterSeconds
      };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);
    const remaining = Math.max(0, this.maxRequests - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
    return {
      allowed: true,
      remaining,
      resetSeconds,
      retryAfterSeconds: 0
    };
  }
}

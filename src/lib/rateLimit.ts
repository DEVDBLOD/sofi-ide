// Simple in-memory rate limiter with brute force protection

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  blockedUntil: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(name: string): Map<string, RateLimitEntry> {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name)!;
}

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now();
  stores.forEach((store) => {
    store.forEach((entry, key) => {
      if (now > entry.blockedUntil && now - entry.firstAttempt > 600_000) {
        store.delete(key);
      }
    });
  });
}, 60_000);

export function rateLimit(
  storeName: string,
  key: string,
  opts: { maxAttempts: number; windowMs: number; blockDurationMs: number }
): { allowed: boolean; retryAfterMs: number } {
  const store = getStore(storeName);
  const now = Date.now();
  const entry = store.get(key);

  // Currently blocked
  if (entry && now < entry.blockedUntil) {
    return { allowed: false, retryAfterMs: entry.blockedUntil - now };
  }

  // Window expired — reset
  if (!entry || now - entry.firstAttempt > opts.windowMs) {
    store.set(key, { count: 1, firstAttempt: now, blockedUntil: 0 });
    return { allowed: true, retryAfterMs: 0 };
  }

  entry.count++;

  if (entry.count > opts.maxAttempts) {
    entry.blockedUntil = now + opts.blockDurationMs;
    return { allowed: false, retryAfterMs: opts.blockDurationMs };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(storeName: string, key: string) {
  const store = getStore(storeName);
  store.delete(key);
}

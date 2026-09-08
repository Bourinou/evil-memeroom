export function createRequestPolicy(allowedOrigins) {
  const ipBudgets = new Map();
  function originAllowed(origin, request) {
    if (!origin) return true; // Native clients authenticate by room invitation + session token.
    try {
      const url = new URL(origin);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        (url.host === request.headers.host ||
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          allowedOrigins.includes(url.origin))
      );
    } catch {
      return false;
    }
  }
  function limited(ip) {
    const now = Date.now();
    let budget = ipBudgets.get(ip);
    if (!budget || now - budget.start > 60000) {
      budget = { start: now, count: 0 };
      ipBudgets.set(ip, budget);
    }
    return ++budget.count > 120;
  }

  return {
    originAllowed,
    limited,
    sweep(now) {
      for (const [ip, budget] of ipBudgets) if (now - budget.start > 60000) ipBudgets.delete(ip);
    },
  };
}

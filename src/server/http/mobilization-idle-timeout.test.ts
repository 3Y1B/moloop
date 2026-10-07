import { describe, expect, it, vi } from 'vitest';
import { applyMobilizationIdleTimeout } from './mobilization-idle-timeout';

describe('Bun idle-timeout exception is restricted to Mobilization generation', () => {
  it.each(['/api/simulateMobilization', '/api/simulateMobilization?test=1'])(
    'disables the idle timeout for POST %s only', (path) => {
      const request = new Request(`http://localhost${path}`, { method: 'POST' });
      const timeout = vi.fn();
      applyMobilizationIdleTimeout(request, { timeout });
      expect(timeout).toHaveBeenCalledExactlyOnceWith(request, 0);
    },
  );

  it.each([
    ['GET', '/api/simulateMobilization'], ['OPTIONS', '/api/simulateMobilization'],
    ['POST', '/api/simulateMobilization/'], ['POST', '/api/simulateMobilizationExtra'],
    ['POST', '/api/getMobilizationRun'], ['POST', '/api/approveMobilization'],
    ['POST', '/auth/sign-in'], ['GET', '/health'],
  ])('keeps Bun defaults for %s %s', (method, path) => {
    const timeout = vi.fn();
    applyMobilizationIdleTimeout(new Request(`http://localhost${path}`, { method }), { timeout });
    expect(timeout).not.toHaveBeenCalled();
  });
});

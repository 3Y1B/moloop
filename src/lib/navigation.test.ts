import { router } from 'expo-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { goBack } from './navigation';

vi.mock('expo-router', () => ({
  router: { canGoBack: vi.fn(), back: vi.fn(), replace: vi.fn() },
}));

beforeEach(() => vi.resetAllMocks());

describe('safe back navigation', () => {
  it('preserves the previous screen when there is navigator history', () => {
    vi.mocked(router.canGoBack).mockReturnValue(true);

    goBack('/inbox');

    expect(router.back).toHaveBeenCalledExactlyOnceWith();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('replaces a directly opened screen with the role-aware staff home by default', () => {
    vi.mocked(router.canGoBack).mockReturnValue(false);

    goBack();

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledExactlyOnceWith('/(staff)');
  });

  it('returns a directly opened playbook to its list', () => {
    vi.mocked(router.canGoBack).mockReturnValue(false);

    goBack('/inbox');

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledExactlyOnceWith('/inbox');
  });

  it('keeps the task ID in a dynamic fallback', () => {
    vi.mocked(router.canGoBack).mockReturnValue(false);
    const taskRoute = { pathname: '/task/[id]' as const, params: { id: 'task-123' } };

    goBack(taskRoute);

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledExactlyOnceWith(taskRoute);
  });

  it('checks current history on every invocation rather than retaining an earlier result', () => {
    vi.mocked(router.canGoBack).mockReturnValueOnce(true).mockReturnValueOnce(false);

    goBack();
    goBack('/inbox');

    expect(router.canGoBack).toHaveBeenCalledTimes(2);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledExactlyOnceWith('/inbox');
  });
});

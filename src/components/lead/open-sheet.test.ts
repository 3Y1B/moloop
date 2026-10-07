import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeedsItem } from '@/data/hooks';
import { needVerb, openNeed } from './open-sheet';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ router: { push } }));

describe('coordinated mobilization navigation', () => {
  beforeEach(() => push.mockClear());
  it('opens Mo review without treating a Mobilization as an existing task', () => {
    const item = { kind: 'mobilization', mobilization: { id: 'plan-1' } } as NeedsItem;
    expect(needVerb(item)).toBe('Review');
    openNeed(item);
    expect(push).toHaveBeenCalledWith({ pathname: '/mobilize/[id]', params: { id: 'plan-1' } });
  });
});

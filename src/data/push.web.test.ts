import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Repo } from './repo';
import { registerForPush } from './push.web';

describe('web notification boundary', () => {
  it('does not call a native token or permission API', async () => {
    const registerPush = vi.fn();
    await registerForPush({ registerPush } as unknown as Repo, { prompt: true });
    expect(registerPush).not.toHaveBeenCalled();
  });

  it('keeps notification SDK imports outside the web entry points and root layout', () => {
    for (const path of ['../app/_layout.tsx', '../components/push-notifications.web.tsx', './push.web.ts']) {
      expect(readFileSync(new URL(path, import.meta.url), 'utf8')).not.toContain("from 'expo-notifications'");
    }
  });

  it('retains the quiet foreground policy in the native component', () => {
    const native = readFileSync(new URL('../components/push-notifications.tsx', import.meta.url), 'utf8');
    for (const key of ['shouldShowBanner', 'shouldShowList', 'shouldPlaySound', 'shouldSetBadge']) {
      expect(native).toContain(`${key}: false`);
    }
  });
});

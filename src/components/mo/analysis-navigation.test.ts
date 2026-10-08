import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Route wiring needs a source-level check: the native navigator is not present in this unit-test runtime. */
describe('manual situation navigation', () => {
  it('opens the Mo Needs action tab for the new request, not the retired staff Team view', () => {
    const simulate = source('../../app/mobilize/simulate.tsx');
    expect(simulate).toContain('router.dismissTo({ pathname: "/(mo)", params: { analysis: id } })');
    expect(simulate).not.toContain('pathname: "/(staff)"');
  });

  it('resets only the tab page when a new analysis arrives so the fresh row is visible', () => {
    const index = source('../../app/(mo)/index.tsx');
    expect(index).toContain("<MoPage key={analysis ?? 'needs-action'}");
    expect(index).toContain('<NeedsList analysisId={analysis} />');
    const layout = source('../../app/(mo)/_layout.tsx');
    expect(layout).not.toMatch(/<CrewMap\s[^>]*\bkey=/);
    expect(layout).not.toMatch(/<Tabs\s[^>]*\bkey=/);
  });

  it('keeps account-owned analysis outside the navigator so opening another tab cannot stop it', () => {
    const layout = source('../../app/_layout.tsx');
    const start = layout.indexOf('<MobilizationAnalysisProvider>');
    const navigator = layout.indexOf('<Stack>');
    const navigatorEnd = layout.indexOf('</Stack>');
    const providerEnd = layout.indexOf('</MobilizationAnalysisProvider>');
    expect(start).toBeGreaterThan(-1);
    expect(navigator).toBeGreaterThan(start);
    expect(providerEnd).toBeGreaterThan(navigatorEnd);
  });
});

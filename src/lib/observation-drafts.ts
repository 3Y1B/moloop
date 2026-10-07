import type { ObservationDraft } from '@/components/mobilization/observation-editor';
import type { MobilizationObservation } from './mobilization-observations';

/**
 * Populate editable fields from scenario inputs without sharing mutable preset data.
 * Blank fields/collections are the editor's unknown representation; never invent a value or approval.
 * The editor import is type-only so this converter also runs without React Native.
 */
export function observationInputsToDrafts(
  rows: readonly MobilizationObservation[],
): ObservationDraft[] {
  return rows.map((row, index): ObservationDraft => {
    const base = {
      id: `preset-${index}-${row.key}`,
      key: row.key,
      zoneSlug: row.zoneSlug ?? '',
      minutesAgo: String(row.minutesAgo),
    };
    switch (row.kind) {
      case 'number':
        return { ...base, kind: 'number', value: row.value == null ? '' : String(row.value) };
      case 'boolean':
        return { ...base, kind: 'boolean', value: row.value };
      case 'status':
        return { ...base, kind: 'status', value: row.value };
      case 'text':
        return { ...base, kind: 'text', value: row.value ?? '' };
      case 'location':
        return { ...base, kind: 'location', value: row.value };
      case 'zone_counts':
        return {
          ...base,
          kind: 'zone_counts',
          value: {
            coverage: row.value?.coverage ?? null,
            entries: row.value?.entries.map((entry) => ({
              zoneSlug: entry.zoneSlug,
              count: String(entry.count),
            })) ?? [],
          },
        };
      case 'locations':
        return {
          ...base,
          kind: 'locations',
          value: row.value?.map((entry) => ({
            zoneSlug: entry.zoneSlug,
            status: entry.status,
            capacity: entry.capacity == null ? '' : String(entry.capacity),
            approved: entry.approved,
          })) ?? [],
        };
      case 'routes':
        return {
          ...base,
          kind: 'routes',
          value: row.value?.map((entry) => ({ ...entry })) ?? [],
        };
    }
  });
}

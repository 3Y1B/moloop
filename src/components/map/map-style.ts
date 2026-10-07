import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { useEffect, useState } from 'react';

import { Colors } from '@/constants/theme';
import { useThemeName } from '@/hooks/use-theme';
import { siteGroundLayers, siteLabelLayers, siteSources } from './map-art';

/*
 * OpenFreeMap's `liberty` style, stripped down and recoloured into a flat, quiet street map,
 * with the festival's illustrated site map (map-art.ts) drawn into it. Same style on iOS,
 * Android and web. Tiles are free and need no key.
 */
const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

type Theme = (typeof Colors)['light' | 'dark'];

const EXTRA = {
  light: { major: '#FDEEB4', casing: '#E2DFD9', majorCasing: '#EAD596', rail: '#DCD9D3', waterText: '#5B86AD', halo: '#FFFFFF' },
  dark: { major: '#4D4839', casing: '#2C2E33', majorCasing: '#3A372D', rail: '#2C2E33', waterText: '#5F7F9C', halo: '#13161B' },
} as const;

/**
 * What's kept of the base map: ground cover, water, roads and paths, buildings, and street names.
 * The rest (shops, cafes, toilets, parking, place names) is left out by default, so layers the base style adds later stay out too.
 */
const KEEP_SOURCES = ['park', 'landcover', 'landuse', 'water', 'waterway', 'transportation', 'building'];

/** Kept layers that still make the map busy, or draw things you can't walk on (tunnels). */
const HIDDEN = /building-3d|road_area_pattern|tunnel_|hatching|one_way|transit_rail|aeroway|landuse_(track|pitch|residential)|park_outline|landcover_(ice|wetland|sand)/;

function kept(layer: LayerSpecification): boolean {
  if (layer.type === 'background') return true;
  if (HIDDEN.test(layer.id) || !('source-layer' in layer) || !layer['source-layer']) return false;
  // Names for streets only: not footpaths, not route shields.
  if (layer.type === 'symbol') return layer['source-layer'] === 'transportation_name' && !/path|shield/.test(layer.id);
  return KEEP_SOURCES.includes(layer['source-layer']);
}

function paintFor(layer: LayerSpecification, t: Theme, x: (typeof EXTRA)['light' | 'dark']): Record<string, unknown> | null {
  const id = layer.id;
  if (layer.type === 'background') return { 'background-color': t.mapGround };
  if (layer.type === 'symbol') {
    return { 'text-color': /water/.test(id) ? x.waterText : t.textSecondary, 'text-halo-color': x.halo, 'text-halo-width': 1.5, 'text-halo-blur': 0 };
  }
  if (layer.type === 'fill') {
    if (/park|wood|grass/.test(id)) return { 'fill-color': t.mapGrass, 'fill-opacity': 1 };
    if (/hospital|school|cemetery/.test(id)) return { 'fill-color': t.backgroundElement };
    if (id === 'water') return { 'fill-color': t.mapWater };
    if (id === 'building') return { 'fill-color': t.mapBuilding, 'fill-outline-color': t.mapBuilding };
    return null;
  }
  if (layer.type === 'line') {
    const major = /motorway|trunk_primary/.test(id);
    if (/waterway/.test(id)) return { 'line-color': t.mapWater };
    if (/rail/.test(id)) return { 'line-color': x.rail };
    if (/casing/.test(id)) return { 'line-color': major ? x.majorCasing : x.casing };
    if (/path_pedestrian/.test(id)) return { 'line-color': t.mapPath, 'line-dasharray': [1, 0] };
    return { 'line-color': major ? x.major : t.mapPath };
  }
  return null;
}

function cleanBase(base: StyleSpecification, t: Theme, x: (typeof EXTRA)['light' | 'dark']): LayerSpecification[] {
  return base.layers
    .filter(kept)
    .map((layer) => {
      const paint = paintFor(layer, t, x);
      const cleaned = (paint ? { ...layer, paint: { ...('paint' in layer ? layer.paint : {}), ...paint } } : layer) as LayerSpecification;
      // The flat building layer normally hands over to the 3D one at z14.
      if (cleaned.id === 'building') {
        const { maxzoom: _maxzoom, ...rest } = cleaned;
        return rest as LayerSpecification;
      }
      return cleaned;
    });
}

function buildStyle(base: StyleSpecification, scheme: 'light' | 'dark'): StyleSpecification {
  const t = Colors[scheme], x = EXTRA[scheme];
  const layers = cleanBase(base, t, x);
  // The site goes above the ground and roads but under the map's own labels. Its badges and names
  // go last: the topmost labels are placed first, so ours win over a street or a park name.
  const firstLabel = layers.findIndex((l) => l.type === 'symbol');
  const at = firstLabel < 0 ? layers.length : firstLabel;
  const site = siteSources(scheme);
  return {
    ...base,
    sources: {
      ...base.sources,
      'site-art': { type: 'geojson', data: site.art },
      'site-points': { type: 'geojson', data: site.points },
    },
    layers: [...layers.slice(0, at), ...siteGroundLayers(scheme), ...layers.slice(at), ...siteLabelLayers(scheme)],
  };
}

let base: Promise<StyleSpecification> | null = null;
const built: Partial<Record<'light' | 'dark', StyleSpecification>> = {};

/** The finished style for the current theme. Null for the moment it takes to fetch the base style once. */
export function useMapStyle(): StyleSpecification | null {
  const scheme = useThemeName();
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (built[scheme]) return;
    let live = true;
    base ??= fetch(BASE_STYLE_URL).then((r) => r.json());
    base
      .then((b) => {
        built[scheme] ??= buildStyle(b, scheme);
        if (live) setLoaded((n) => n + 1);
      })
      .catch(() => {
        base = null; // try again next mount
      });
    return () => {
      live = false;
    };
  }, [scheme]);
  return built[scheme] ?? null;
}

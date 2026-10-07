import 'maplibre-gl/dist/maplibre-gl.css';

import { Asset } from 'expo-asset';
import type { Map as GLMap, Marker as GLMarker, StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, View } from 'react-native';

import { VoiceGradient } from '@/constants/theme';
import { toLngLat, type Point } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';
import { MapButton } from './map-button';
import { MAP_ICON_SIZE, STYLE_ICONS } from './map-icons';
import { useOverlays } from './map-markers';
import { clampToLimit, frameBox, liveData, liveLayers, minZoomFor, panLimit, type VenueMapProps } from './map-model';
import { useFollow } from './use-follow';
import { useMapStyle } from './map-style';
import { useGlide } from './use-glide';

export { zoneSpot, type MapMarker, type MapPerson } from './map-model';

type GL = typeof import('maplibre-gl');

const LIVE = liveLayers(VoiceGradient);
const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';

/**
 * The web build of VenueMap: the same style and overlays on maplibre-gl. Loaded on demand, so it never runs on the server.
 * MapLibre v6 uses an ESM worker; scripts/sync-maplibre-worker.mjs publishes its exact version via Expo's public directory.
 */
export function VenueMap(props: VenueMapProps) {
  const { route, target, targetColor, frame, interactive = true, style } = props;
  const theme = useTheme();
  const baseStyle = useMapStyle();
  const holder = useRef<HTMLDivElement>(null);
  const [gl, setGl] = useState<{ lib: GL; map: GLMap } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const box = size ? frameBox(props, size) : null;
  const { camera, onUserMove, canRecenter, recenter } = useFollow(props, size);
  const overlays = useOverlays(props, box && size ? box.w / size.width : 1);

  // The live route and highlight ride along in the style; setStyle diffs it into a data update.
  const liveKey = JSON.stringify(liveData(route, target, targetColor ?? theme.danger));
  const fullStyle = useMemo<StyleSpecification | null>(
    // maplibre-gl bundles its own copy of the style-spec types; the JSON is the same.
    () =>
      baseStyle &&
      ({
        ...baseStyle,
        sources: {
          ...baseStyle.sources,
          live: { type: 'geojson', data: JSON.parse(liveKey), lineMetrics: true },
        },
        layers: [...baseStyle.layers, ...LIVE],
      } as unknown as StyleSpecification),
    [baseStyle, liveKey],
  );

  // What the map is created with; later changes go through setStyle and easeTo.
  const first = useRef({ style: fullStyle, camera, onUserMove, size, frame });
  useEffect(() => {
    first.current = { style: fullStyle, camera, onUserMove, size, frame };
  });
  const ready = !!fullStyle && !!camera;
  useEffect(() => {
    if (!ready || !holder.current) return;
    let map: GLMap | undefined;
    let gone = false;
    Promise.all([import('maplibre-gl'), loadIcons()]).then(([lib, icons]) => {
      if (gone || !holder.current) return;
      lib.setWorkerUrl(MAPLIBRE_WORKER_URL);
      const { style: s, camera: c } = first.current;
      map = new lib.Map({
        container: holder.current,
        style: s!,
        ...c!,
        // Keep the site in view, square to the plan; the stock maxBounds is a lng/lat box that also blocks zooming out.
        transformConstrain: (lngLat, zoom) => {
          const { size: z, frame: f, camera: auto } = first.current;
          if (!z) return { center: lngLat, zoom };
          zoom = Math.min(Math.max(zoom, minZoomFor(z, f, auto)), 22);
          return {
            center: new lib.LngLat(...clampToLimit([lngLat.lng, lngLat.lat], panLimit(zoom, z, f, auto))),
            zoom,
          };
        },
        interactive,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: interactive ? { compact: true } : false,
      });
      map.touchZoomRotate.disableRotation();
      // Only moves the person makes carry the browser event; the map's own easing doesn't.
      const took = (e: { originalEvent?: unknown }) => e.originalEvent && first.current.onUserMove();
      map.on('dragstart', took);
      map.on('zoomstart', took);
      // The style names its badges; hand them over whenever it asks, including after a setStyle.
      map.on('styleimagemissing', ({ id }: { id: string }) => {
        const img = icons[id];
        if (img && !map!.hasImage(id)) map!.addImage(id, img, { pixelRatio: img.naturalWidth / MAP_ICON_SIZE });
      });
      map.once('load', () => fold(map!));
      setGl({ lib, map });
    });
    return () => {
      gone = true;
      map?.remove();
      setGl(null);
    };
  }, [ready, interactive]);

  useEffect(() => {
    if (!gl || !fullStyle) return;
    gl.map.setStyle(fullStyle);
    gl.map.once('idle', () => fold(gl.map));
  }, [gl, fullStyle]);

  const cameraKey = camera && JSON.stringify(camera);
  useEffect(() => {
    if (gl && camera) gl.map.easeTo({ ...camera, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, cameraKey]);

  useEffect(() => {
    // The map sizes itself from its container, which can change without a window resize (sheets, rotation).
    gl?.map.resize();
  }, [gl, size?.width, size?.height]);

  return (
    <View
      style={[styles.wrap, { backgroundColor: theme.mapGround }, style]}
      pointerEvents={interactive ? 'auto' : 'none'}
      onLayout={(e) => {
        // A screen underneath lays out at 0 × 0; keep the last real size.
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) setSize({ width, height });
      }}
    >
      <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
      {gl &&
        overlays.map((o) => (
          <WebMarker key={o.key} gl={gl} at={o.at} anchor={o.anchor} onPress={o.onPress}>
            {o.view}
          </WebMarker>
        ))}
      {gl && interactive && canRecenter && size && (
        <MapButton
          label="Back to me"
          sf="location.fill"
          md="my_location"
          onPress={() => recenter((c) => gl.map.easeTo({ ...c, duration: 600 }))}
          style={[styles.recenter, { bottom: (frame?.bottom ?? 0) * size.height + 12 }]}
        />
      )}
      {gl && interactive && <AttributionNudge map={gl.map} top={(frame?.top ?? 0) * (size?.height ?? 0)} />}
    </View>
  );
}

let icons: Promise<Record<string, HTMLImageElement>> | null = null;

/** The map's badges, loaded once before the first map is made. */
function loadIcons() {
  icons ??= Promise.all(
    Object.entries(STYLE_ICONS).map(
      ([name, mod]) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new window.Image();
          img.onload = () => resolve([name, img]);
          img.onerror = reject;
          img.src = Asset.fromModule(mod).uri;
        }),
    ),
  ).then((pairs) => Object.fromEntries(pairs));
  icons.catch(() => {
    icons = null; // try again next mount
  });
  return icons;
}

/** Compact attribution opens itself whenever the style changes; keep it folded to the (i) button. */
function fold(map: GLMap) {
  map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
}

/** An RN view pinned to the map: rendered into a DOM element maplibre-gl moves around. */
function WebMarker({
  gl,
  at,
  anchor,
  onPress,
  children,
}: {
  gl: { lib: GL; map: GLMap };
  at: Point;
  anchor: 'center' | 'bottom';
  onPress?: () => void;
  children: ReactElement;
}) {
  const pressable = !!onPress;
  const el = useMemo(() => {
    const div = document.createElement('div');
    div.style.pointerEvents = pressable ? 'auto' : 'none';
    return div;
  }, [pressable]);
  const marker = useRef<GLMarker | null>(null);
  const [lng, lat] = toLngLat(useGlide(at));
  useEffect(() => {
    const m = new gl.lib.Marker({ element: el, anchor }).setLngLat([lng, lat]).addTo(gl.map);
    marker.current = m;
    return () => {
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, el, anchor]);
  useEffect(() => {
    marker.current?.setLngLat([lng, lat]);
  }, [lng, lat]);
  return createPortal(onPress ? <Pressable onPress={onPress}>{children}</Pressable> : children, el);
}

/** Keeps the map's attribution clear of the controls floating along the top. */
function AttributionNudge({ map, top }: { map: GLMap; top: number }) {
  useEffect(() => {
    const el = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-bottom-right');
    if (el) Object.assign(el.style, { top: `${top + 4}px`, bottom: 'auto' });
  }, [map, top]);
  return null;
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  recenter: { position: 'absolute', right: 16 },
});

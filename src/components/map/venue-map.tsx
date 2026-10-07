import { Camera, GeoJSONSource, Images, Layer, Map, Marker, type CameraRef, type LayerProps } from '@maplibre/maplibre-react-native';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { VoiceGradient } from '@/constants/theme';
import { toLngLat } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';
import { MapButton } from './map-button';
import { STYLE_ICONS } from './map-icons';
import { useOverlays, type Overlay } from './map-markers';
import { frameBox, liveData, liveLayers, minZoomFor, panBounds, panLimit, type VenueMapProps } from './map-model';
import { useFollow } from './use-follow';
import { useMapStyle } from './map-style';
import { useGlide } from './use-glide';

export { zoneSpot, type MapMarker, type MapPerson } from './map-model';

// Drawn inside the live source, so they don't name it.
const LIVE = liveLayers(VoiceGradient).map((l) => {
  const { source: _source, ...layer } = l as typeof l & { source?: string };
  return layer as LayerProps;
});

/** The real site under the festival plan, with my position, the destination, the walking route and people on it. */
export function VenueMap(props: VenueMapProps) {
  const { route, target, targetColor, frame, interactive = true, style } = props;
  const theme = useTheme();
  const mapStyle = useMapStyle();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const box = size ? frameBox(props, size) : null;
  const overlays = useOverlays(props, box && size ? box.w / size.width : 1);
  // Jump into place on first show, glide after that.
  const [placed, setPlaced] = useState(false);
  const { camera, onUserMove, canRecenter, recenter } = useFollow(props, size);
  const cameraRef = useRef<CameraRef>(null);
  // Where the map can go depends on how far in it is; settles after each move, which is close enough to hold the edge.
  const [zoom, setZoom] = useState<number | null>(null);
  const shownZoom = zoom ?? camera?.zoom;

  return (
    <View
      style={[styles.wrap, { backgroundColor: theme.mapGround }, style]}
      pointerEvents={interactive ? 'auto' : 'none'}
      onLayout={(e) => {
        // A screen underneath lays out at 0 × 0; keep the last real size.
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) setSize({ width, height });
      }}>
      {mapStyle && size && camera && (
        <Map
          style={StyleSheet.absoluteFill}
          mapStyle={mapStyle}
          logo={false}
          compass={false}
          attribution={interactive}
          attributionPosition={{ top: (frame?.top ?? 0) * size.height + 4, right: 8 }}
          dragPan={interactive}
          touchZoom={interactive}
          doubleTapZoom={interactive}
          touchRotate={false}
          touchPitch={false}
          onDidFinishLoadingMap={() => setPlaced(true)}
          onRegionWillChange={(e) => e.nativeEvent.userInteraction && onUserMove()}
          onRegionDidChange={(e) => setZoom(Math.round(e.nativeEvent.zoom * 8) / 8)}>
          <Camera
            ref={cameraRef}
            {...camera}
            minZoom={minZoomFor(size, frame, camera)}
            maxBounds={shownZoom != null ? panBounds(panLimit(shownZoom, size, frame, camera)) : undefined}
            duration={placed ? 500 : 0}
            easing="ease"
          />
          <Images images={STYLE_ICONS} />
          <GeoJSONSource id="live" data={liveData(route, target, targetColor ?? theme.danger)} lineMetrics>
            {LIVE.map((layer) => <Layer key={layer.id} {...layer} />)}
          </GeoJSONSource>
          {overlays.map((o) => <GlidingMarker key={o.key} overlay={o} />)}
        </Map>
      )}
      {interactive && canRecenter && size && (
        <MapButton
          label="Back to me"
          sf="location.fill"
          md="my_location"
          onPress={() => recenter((c) => cameraRef.current?.easeTo({ ...c, duration: 600, easing: 'ease' }))}
          style={[styles.recenter, { bottom: (frame?.bottom ?? 0) * size.height + 12 }]}
        />
      )}
    </View>
  );
}

/** A marker that walks to its new spot instead of jumping. Re-renders on its own, not the whole map. */
function GlidingMarker({ overlay: o }: { overlay: Overlay }) {
  const at = useGlide(o.at);
  return (
    <Marker id={o.key} lngLat={toLngLat(at)} anchor={o.anchor} onPress={o.onPress} pointerEvents={o.onPress ? 'auto' : 'none'}>
      {o.view}
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  recenter: { position: 'absolute', right: 16 },
});

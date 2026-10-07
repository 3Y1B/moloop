import { Camera, GeoJSONSource, Images, Layer, Map, Marker, type LayerProps } from '@maplibre/maplibre-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { VoiceGradient } from '@/constants/theme';
import { toLngLat } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';
import { STYLE_ICONS } from './map-icons';
import { useOverlays } from './map-markers';
import { cameraFor, frameBox, liveData, liveLayers, type VenueMapProps } from './map-model';
import { useMapStyle } from './map-style';

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
  const camera = box && size ? cameraFor(box, size.width) : null;

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
          onDidFinishLoadingMap={() => setPlaced(true)}>
          <Camera {...camera} minZoom={13} duration={placed ? 500 : 0} easing="ease" />
          <Images images={STYLE_ICONS} />
          <GeoJSONSource id="live" data={liveData(route, target, targetColor ?? theme.danger)} lineMetrics>
            {LIVE.map((layer) => <Layer key={layer.id} {...layer} />)}
          </GeoJSONSource>
          {overlays.map((o) => (
            <Marker key={o.key} id={o.key} lngLat={toLngLat(o.at)} anchor={o.anchor} onPress={o.onPress} pointerEvents={o.onPress ? 'auto' : 'none'}>
              {o.view}
            </Marker>
          ))}
        </Map>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});

import React, { useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { delhiNetwork, LINE_COLORS } from '../metro/delhiNetwork';
import type { LineDef, StationDef } from '../metro/data';

interface Theme {
  bg: string;
  surface: string;
  surface2: string;
  surfaceElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  red: string;
  green: string;
  greenSoft: string;
  amber: string;
  amberSoft: string;
}

export interface MetroMapScreenProps {
  t: Theme;
  onSelectOrigin: (stationId: string) => void;
  onSelectDestination: (stationId: string) => void;
  currentOrigin?: string;
  currentDest?: string;
}

interface StationInfo {
  id: string;
  name: string;
  lines: { id: string; name: string; color: string }[];
  isInterchange: boolean;
}

export function MetroMapScreen({
  t,
  onSelectOrigin,
  onSelectDestination,
  currentOrigin,
  currentDest,
}: MetroMapScreenProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [selectedLineId, setSelectedLineId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inspectedStation, setInspectedStation] = useState<StationInfo | null>(null);

  const hScrollRef = useRef<ScrollView>(null);
  const vScrollRef = useRef<ScrollView>(null);

  // Build index of all stations and their line memberships
  const { allStations, stationMap, lineList } = useMemo(() => {
    const sMap = new Map<string, StationInfo>();
    const lines: { id: string; name: string; color: string; stations: StationDef[] }[] = [];

    for (const line of delhiNetwork.lines) {
      const lineStations: StationDef[] = [];
      const col = LINE_COLORS[line.id] ?? '#3b82f6';

      for (const seg of line.segments) {
        for (const st of seg.stations) {
          if (!lineStations.some(s => s.id === st.id)) {
            lineStations.push(st);
          }
          let existing = sMap.get(st.id);
          if (!existing) {
            existing = {
              id: st.id,
              name: st.name,
              lines: [],
              isInterchange: false,
            };
            sMap.set(st.id, existing);
          }
          if (!existing.lines.some(l => l.id === line.id)) {
            existing.lines.push({ id: line.id, name: line.name, color: col });
          }
          existing.isInterchange = existing.lines.length > 1;
        }
      }

      lines.push({
        id: line.id,
        name: line.name,
        color: col,
        stations: lineStations,
      });
    }

    const allList = Array.from(sMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    return { allStations: allList, stationMap: sMap, lineList: lines };
  }, []);

  // Filtered stations by line and search query
  const displayedStations = useMemo(() => {
    let list: StationInfo[] = allStations;
    if (selectedLineId !== 'all') {
      list = list.filter(s => s.lines.some(l => l.id === selectedLineId));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [allStations, selectedLineId, searchQuery]);

  // Zoom handlers
  const handleZoomIn = () => setZoomLevel(z => Math.min(2.5, +(z + 0.35).toFixed(2)));
  const handleZoomOut = () => setZoomLevel(z => Math.max(0.85, +(z - 0.35).toFixed(2)));
  const handleResetZoom = () => {
    setZoomLevel(1.0);
    hScrollRef.current?.scrollTo({ x: 300, animated: true });
    vScrollRef.current?.scrollTo({ y: 300, animated: true });
  };

  const MAP_BASE_SIZE = 900;
  const mapRenderSize = Math.round(MAP_BASE_SIZE * zoomLevel);

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={[styles.headerCard, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, { color: t.text }]}>Delhi Metro Network Map</Text>
          <View style={[styles.offlineBadge, { backgroundColor: t.greenSoft, borderColor: t.green }]}>
            <Text style={[styles.offlineBadgeText, { color: t.green }]}>● 100% Offline</Text>
          </View>
        </View>
        <Text style={[styles.headerSubtitle, { color: t.textDim }]}>
          Pinch, pan, and explore all {allStations.length} stations across Delhi-NCR.
        </Text>

        {/* Search Input */}
        <View style={[styles.searchBox, { backgroundColor: t.surface2, borderColor: t.border }]}>
          <Text style={[styles.searchIcon, { color: t.textFaint }]}>🔍</Text>
          <TextInput
            style={[styles.searchInput, { color: t.text }]}
            placeholder="Search any station (e.g. Rajiv Chowk)…"
            placeholderTextColor={t.textFaint}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Text style={[styles.clearSearchText, { color: t.textDim }]}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Line Filter Chips */}
      <View style={styles.lineFilterWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.lineFilterScroll}>
          <Pressable
            style={[
              styles.lineChip,
              { backgroundColor: t.surface, borderColor: t.border },
              selectedLineId === 'all' && { backgroundColor: t.accent, borderColor: t.accent },
            ]}
            onPress={() => setSelectedLineId('all')}>
            <Text
              style={[
                styles.lineChipText,
                { color: selectedLineId === 'all' ? t.onAccent : t.text },
              ]}>
              All Lines ({allStations.length})
            </Text>
          </Pressable>
          {lineList.map(line => {
            const isSelected = selectedLineId === line.id;
            return (
              <Pressable
                key={line.id}
                style={[
                  styles.lineChip,
                  { backgroundColor: t.surface, borderColor: t.border },
                  isSelected && { backgroundColor: line.color, borderColor: line.color },
                ]}
                onPress={() => setSelectedLineId(line.id)}>
                <View style={[styles.lineDot, { backgroundColor: line.color }]} />
                <Text
                  style={[
                    styles.lineChipText,
                    { color: isSelected ? '#ffffff' : t.text },
                  ]}>
                  {line.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Interactive Map Viewer Container */}
      <View style={[styles.mapFrame, { backgroundColor: t.surface, borderColor: t.border }]}>
        {/* Floating Zoom HUD */}
        <View style={[styles.zoomControls, { backgroundColor: t.surface2, borderColor: t.border }]}>
          <Pressable onPress={handleZoomIn} style={styles.zoomBtn} hitSlop={6}>
            <Text style={[styles.zoomBtnText, { color: t.text }]}>➕</Text>
          </Pressable>
          <View style={[styles.zoomDivider, { backgroundColor: t.border }]} />
          <Pressable onPress={handleResetZoom} style={styles.zoomBtn} hitSlop={6}>
            <Text style={[styles.zoomLabelText, { color: t.accent }]}>{Math.round(zoomLevel * 100)}%</Text>
          </Pressable>
          <View style={[styles.zoomDivider, { backgroundColor: t.border }]} />
          <Pressable onPress={handleZoomOut} style={styles.zoomBtn} hitSlop={6}>
            <Text style={[styles.zoomBtnText, { color: t.text }]}>➖</Text>
          </Pressable>
        </View>

        {/* 2D Pan ScrollView */}
        <ScrollView
          ref={vScrollRef}
          style={styles.vScroll}
          contentContainerStyle={styles.vScrollContent}
          maximumZoomScale={3.0}
          minimumZoomScale={0.8}
          showsVerticalScrollIndicator={true}>
          <ScrollView
            ref={hScrollRef}
            horizontal
            style={styles.hScroll}
            contentContainerStyle={styles.hScrollContent}
            showsHorizontalScrollIndicator={true}>
            <View style={{ width: mapRenderSize, height: mapRenderSize }}>
              <Image
                source={require('../../assets/map/delhi_metro_map.png')}
                style={{ width: mapRenderSize, height: mapRenderSize }}
                resizeMode="contain"
              />
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      {/* Station Details Inspector Bottom Card (When a station is tapped or searched) */}
      {inspectedStation ? (
        <View style={[styles.inspectCard, { backgroundColor: t.surface, borderColor: t.accent }]}>
          <View style={styles.inspectHead}>
            <View style={styles.inspectTitleCol}>
              <View style={styles.inspectBadgeRow}>
                <Text style={[styles.inspectStationName, { color: t.text }]}>
                  {inspectedStation.name}
                </Text>
                {inspectedStation.isInterchange ? (
                  <View style={[styles.interchangePill, { backgroundColor: t.amberSoft }]}>
                    <Text style={[styles.interchangePillText, { color: t.amber }]}>
                      🔄 Interchange Hub
                    </Text>
                  </View>
                ) : null}
              </View>
              {/* Lines passing through */}
              <View style={styles.inspectLinesRow}>
                {inspectedStation.lines.map(l => (
                  <View key={l.id} style={[styles.lineTag, { backgroundColor: l.color }]}>
                    <Text style={styles.lineTagText}>{l.name}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Pressable
              onPress={() => setInspectedStation(null)}
              style={styles.inspectCloseBtn}
              hitSlop={10}>
              <Text style={[styles.inspectCloseText, { color: t.textDim }]}>✕</Text>
            </Pressable>
          </View>

          {/* Action buttons to cross-link into Alarm and Planner */}
          <View style={styles.inspectActionsRow}>
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: t.accent },
                pressed && styles.btnPressed,
              ]}
              onPress={() => {
                onSelectOrigin(inspectedStation.id);
                setInspectedStation(null);
              }}>
              <Text style={[styles.actionBtnText, { color: t.onAccent }]}>
                🚀 Set as Boarding Station
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: t.surface2, borderColor: t.border, borderWidth: 1 },
                pressed && styles.btnPressed,
              ]}
              onPress={() => {
                onSelectDestination(inspectedStation.id);
                setInspectedStation(null);
              }}>
              <Text style={[styles.actionBtnText, { color: t.text }]}>
                🏁 Set as Destination
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Station List Browser (Quick select list for the selected line) */}
      <View style={[styles.stationListCard, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={styles.stationListHeader}>
          <Text style={[styles.stationListTitle, { color: t.text }]}>
            {selectedLineId === 'all'
              ? `Stations (${displayedStations.length})`
              : `${lineList.find(l => l.id === selectedLineId)?.name ?? 'Line'} Stations (${displayedStations.length})`}
          </Text>
          <Text style={[styles.stationListHelp, { color: t.textDim }]}>
            Tap any station to inspect & route
          </Text>
        </View>

        <ScrollView
          style={styles.stationListScroll}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled">
          {displayedStations.slice(0, 35).map(st => {
            const isOrigin = currentOrigin === st.id;
            const isDest = currentDest === st.id;
            return (
              <Pressable
                key={st.id}
                style={({ pressed }) => [
                  styles.stationRow,
                  { borderBottomColor: t.border },
                  pressed && { backgroundColor: t.surface2 },
                  (isOrigin || isDest) && { backgroundColor: t.accentSoft },
                ]}
                onPress={() => setInspectedStation(st)}>
                <View style={styles.stationRowLeft}>
                  <Text
                    style={[
                      styles.stationRowName,
                      { color: isOrigin || isDest ? t.accent : t.text },
                    ]}>
                    {st.name}
                  </Text>
                  <View style={styles.stationRowBadges}>
                    {st.lines.map(l => (
                      <View
                        key={l.id}
                        style={[styles.smallLineDot, { backgroundColor: l.color }]}
                      />
                    ))}
                    {st.isInterchange ? (
                      <Text style={[styles.stationRowInterchange, { color: t.amber }]}>
                        🔄 Transfer
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.stationRowRight}>
                  {isOrigin ? (
                    <Text style={[styles.statusTag, { color: t.accent }]}>Origin</Text>
                  ) : isDest ? (
                    <Text style={[styles.statusTag, { color: t.green }]}>Dest</Text>
                  ) : (
                    <Text style={[styles.inspectArrow, { color: t.textFaint }]}>Inspect ➔</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginBottom: 10,
  },
  offlineBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  offlineBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 4,
  },
  clearSearchText: {
    fontSize: 14,
    paddingHorizontal: 4,
  },
  lineFilterWrap: {
    marginBottom: 10,
  },
  lineFilterScroll: {
    paddingHorizontal: 2,
    gap: 6,
  },
  lineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  lineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  lineChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  mapFrame: {
    height: 380,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 10,
  },
  zoomControls: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  zoomBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  zoomBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  zoomLabelText: {
    fontSize: 11,
    fontWeight: '800',
  },
  zoomDivider: {
    width: 1,
    height: 16,
  },
  vScroll: {
    flex: 1,
  },
  vScrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hScroll: {
    flex: 1,
  },
  hScrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    marginBottom: 10,
  },
  inspectHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  inspectTitleCol: {
    flex: 1,
  },
  inspectBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  inspectStationName: {
    fontSize: 16,
    fontWeight: '800',
  },
  interchangePill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  interchangePillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  inspectLinesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  lineTag: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lineTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  inspectCloseBtn: {
    padding: 4,
  },
  inspectCloseText: {
    fontSize: 16,
    fontWeight: '700',
  },
  inspectActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.8,
  },
  stationListCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  stationListHeader: {
    marginBottom: 8,
  },
  stationListTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  stationListHelp: {
    fontSize: 11,
    marginTop: 2,
  },
  stationListScroll: {
    maxHeight: 220,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  stationRowLeft: {
    flex: 1,
  },
  stationRowName: {
    fontSize: 13,
    fontWeight: '600',
  },
  stationRowBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  smallLineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stationRowInterchange: {
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  stationRowRight: {
    marginLeft: 8,
  },
  statusTag: {
    fontSize: 11,
    fontWeight: '700',
  },
  inspectArrow: {
    fontSize: 11,
  },
});

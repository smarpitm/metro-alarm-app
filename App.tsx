import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TextStyle, ViewStyle } from 'react-native';
import type { Plan } from './src/metro/planner';
import { planFastest, planLeastChanges } from './src/metro/planner';
import { LINE_COLORS, collectStationsWithCoords, delhiNetwork } from './src/metro/delhiNetwork';
import { collectStations } from './src/metro/data';
import { MetroAlarm } from './src/native/MetroAlarm';
import { TripController, hav } from './src/trip/TripController';
import type { TripSnapshot } from './src/trip/TripController';

const fmtMin = (seconds: number) => `${Math.round(seconds / 60)} min`;

/** Type-to-search station picker with auto-complete suggestions. */
function TypeaheadPicker(props: {
  label: string;
  value: string;
  options: Map<string, string>;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const all = [...props.options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    if (!query.trim()) return all.slice(0, 12);
    const q = query.trim().toLowerCase();
    return all.filter(([, name]) => name.toLowerCase().includes(q)).slice(0, 12);
  }, [props.options, query]);

  return (
    <View>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={open ? query : props.options.get(props.value) ?? ''}
        placeholder="Type station name…"
        placeholderTextColor="#999"
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChangeText={setQuery}
      />
      {open ? (
        <View style={styles.suggestBox}>
          {filtered.map(([id, name]) => (
            <Pressable
              key={id}
              style={styles.suggestRow}
              onPress={() => {
                props.onChange(id);
                setOpen(false);
              }}>
              <Text style={styles.suggestText} numberOfLines={1}>
                {name}
              </Text>
            </Pressable>
          ))}
          {filtered.length === 0 ? (
            <Text style={styles.note}>No station matches “{query}”</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function LineChip(props: { lineId: string; lineName: string }) {
  const color = LINE_COLORS[props.lineId] ?? '#555';
  return (
    <View style={[styles.chip, { backgroundColor: color }]}>
      <Text style={styles.chipText} numberOfLines={1}>
        {props.lineName.replace(' Line', '')}
      </Text>
    </View>
  );
}

function RouteCard(props: { title: string; plan: Plan | null; note?: string }) {
  if (!props.plan) {
    return null;
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      <Text style={styles.summary}>
        {fmtMin(props.plan.timeS)} · {props.plan.stationCount} stations ·{' '}
        {props.plan.changes} {props.plan.changes === 1 ? 'change' : 'changes'}
      </Text>
      <View style={styles.legs}>
        {props.plan.legs.map((leg, i) => (
          <View key={i} style={styles.leg}>
            <LineChip lineId={leg.lineId} lineName={leg.lineName} />
            <Text style={styles.legText} numberOfLines={1}>
              {leg.boardName} → {leg.alightName}
            </Text>
          </View>
        ))}
      </View>
      {props.note ? <Text style={styles.note}>{props.note}</Text> : null}
    </View>
  );
}

/** Trip screen: declare boarding + destination, get an alarm N stops before. */
function TripScreen(props: {
  stations: Map<string, string>;
  options: string[];
  testAlarmState: boolean;
}) {
  const stations = props.stations;
  const [enteredAt, setEnteredAt] = useState('dwarka-sector-21');
  const [dest, setDest] = useState('yashobhoomi-dwarka-sector-25');
  const [buffer, setBuffer] = useState<1 | 2>(1);
  const [locating, setLocating] = useState(false);
  const [snap, setSnap] = useState<TripSnapshot>({
    state: 'idle',
    lastStation: null,
    stopsRemaining: null,
    distM: null,
    etaS: null,
  });
  const trip = useRef<TripController | null>(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('MetroTripLocation', fix => {
      trip.current?.onFix(fix);
    });
    return () => {
      sub.remove();
      trip.current?.cancel();
    };
  }, []);

  const autoDetectOrigin = async () => {
    setLocating(true);
    try {
      await MetroAlarm.requestLocationPermission();
      const loc = await MetroAlarm.getLastKnownLocation();
      if (loc) {
        const coords = collectStationsWithCoords(delhiNetwork);
        let closestId = enteredAt;
        let minDist = Infinity;
        for (const s of coords) {
          const d = hav(loc, s);
          if (d < minDist) {
            minDist = d;
            closestId = s.id;
          }
        }
        setEnteredAt(closestId);
      }
    } finally {
      setLocating(false);
    }
  };

  const swapStations = () => {
    const temp = enteredAt;
    setEnteredAt(dest);
    setDest(temp);
  };

  const startTrip = async () => {
    await MetroAlarm.requestNotificationPermission();
    await MetroAlarm.requestLocationPermission();
    const controller = new TripController(delhiNetwork, s => setSnap({ ...s }));
    trip.current = controller;
    controller.arm({ enteredAtId: enteredAt, destId: dest, bufferStops: buffer });
    await MetroAlarm.startLocationUpdates();
  };

  const cancelTrip = () => {
    trip.current?.cancel();
    void MetroAlarm.stopLocationUpdates();
  };

  const dismissAlarm = () => {
    trip.current?.dismiss();
  };

  const snoozeAlarm = () => {
    trip.current?.snooze(3);
  };

  return (
    <View>
      {snap.state === 'idle' ? (
        <>
          <Text style={styles.sub}>Boarded the metro? Tell us where — the alarm will fire{'\n'}
{buffer} stop(s) before your station, even with the screen off.</Text>
          <TypeaheadPicker
            label="I entered at"
            value={enteredAt}
            options={stations}
            onChange={setEnteredAt}
          />
          <View style={styles.pickerActionRow}>
            <Pressable style={styles.quickActionBtn} onPress={autoDetectOrigin} disabled={locating}>
              <Text style={styles.quickActionText}>
                {locating ? '📍 Locating station…' : '📍 Auto-detect origin'}
              </Text>
            </Pressable>
            <Pressable style={styles.quickActionBtn} onPress={swapStations}>
              <Text style={styles.quickActionText}>⇅ Swap</Text>
            </Pressable>
          </View>
          <TypeaheadPicker
            label="Going to"
            value={dest}
            options={stations}
            onChange={setDest}
          />
          <View style={styles.bufferRow}>
            <Text style={styles.bufferLabel}>Alarm before destination:</Text>
            {[1, 2].map(n => (
              <Pressable
                key={n}
                style={[styles.bufferChip, buffer === n && styles.bufferChipOn]}
                onPress={() => setBuffer(n as 1 | 2)}>
                <Text style={[styles.bufferText, buffer === n && styles.bufferTextOn]}>
                  {n} stop{n > 1 ? 's' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.primaryBtn} onPress={startTrip}>
            <Text style={styles.primaryBtnText}>▶ Start trip</Text>
          </Pressable>
          <Text style={styles.note}>
            Keep the app in the foreground (or trust the notification) and lock your
            phone — a GPS anchor above ground plus timing estimates underground drive
            the countdown.
          </Text>
        </>
      ) : (
        <View style={styles.tripCard}>
          <Text style={styles.tripState}>
            {snap.state === 'alarmed'
              ? '🚨 ALARM — get ready to get off!'
              : snap.state === 'done'
                ? '✅ Arrived — trip complete'
                : '🚇 Riding…'}
          </Text>
          <Text style={styles.tripBig}>
            {snap.stopsRemaining != null
              ? `${Math.max(0, Math.ceil(snap.stopsRemaining))} stop(s) remaining`
              : 'Waiting for GPS anchor…'}
          </Text>
          <Text style={styles.tripSub}>
            {snap.lastStation ? `Last confirmed: ${snap.lastStation}\n` : ''}
            {snap.distM != null ? `${Math.round(snap.distM)} m to destination\n` : ''}
            {snap.etaS != null ? `~${fmtMin(snap.etaS)} left` : ''}
          </Text>
          {snap.state === 'alarmed' ? (
            <View style={styles.alarmActionRow}>
              <Pressable style={[styles.primaryBtn, styles.snoozeBtn]} onPress={snoozeAlarm}>
                <Text style={styles.primaryBtnText}>💤 Snooze 3m</Text>
              </Pressable>
              <Pressable style={[styles.primaryBtn, styles.silenceBtn]} onPress={dismissAlarm}>
                <Text style={styles.primaryBtnText}>Silence alarm</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable style={[styles.primaryBtn, styles.stopTripBtn]} onPress={cancelTrip}>
            <Text style={styles.primaryBtnText}>End trip</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function App(): React.JSX.Element {
  const stations = useMemo(() => collectStations(delhiNetwork), []);
  const options = useMemo(() => Array.from(stations.keys()), [stations]);

  const [mode, setMode] = useState<'planner' | 'trip'>('planner');
  const [origin, setOrigin] = useState('dwarka-sector-21');
  const [dest, setDest] = useState('yashobhoomi-dwarka-sector-25');
  const [alarmRinging, setAlarmRinging] = useState(false);

  const fastest = useMemo(
    () => (origin !== dest ? planFastest(delhiNetwork, origin, dest) : null),
    [origin, dest],
  );
  const leastChanges = useMemo(
    () => (origin !== dest ? planLeastChanges(delhiNetwork, origin, dest) : null),
    [origin, dest],
  );
  const identical =
    fastest != null &&
    leastChanges != null &&
    fastest.changes === leastChanges.changes &&
    fastest.timeS === leastChanges.timeS;

  const toggleTestAlarm = async () => {
    if (alarmRinging) {
      await MetroAlarm.stopAlarm();
      setAlarmRinging(false);
      return;
    }
    await MetroAlarm.requestNotificationPermission();
    await MetroAlarm.startAlarm();
    setAlarmRinging(true);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.tabs}>
        {(['planner', 'trip'] as const).map(m => (
          <Pressable
            key={m}
            style={[styles.tab, mode === m && styles.tabOn]}
            onPress={() => setMode(m)}>
            <Text style={[styles.tabText, mode === m && styles.tabTextOn]}>{m === 'planner' ? '🗺 Planner' : '🚨 Trip alarm'}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {mode === 'planner' ? (
          <>
            <Text style={styles.header}>Metro Route Planner</Text>
            <Text style={styles.sub}>Delhi Metro · {options.length} stations · offline</Text>
            <TypeaheadPicker label="From" value={origin} options={stations} onChange={setOrigin} />
            <TypeaheadPicker label="To" value={dest} options={stations} onChange={setDest} />
            {origin === dest ? (
              <Text style={styles.note}>Pick two different stations.</Text>
            ) : (
              <>
                <RouteCard title="⏱ Fastest" plan={fastest} />
                <RouteCard title="🔁 Least changes" plan={leastChanges} />
                {identical ? (
                  <Text style={styles.note}>
                    Both routes are the same — origin and destination share one line.
                  </Text>
                ) : null}
                <Pressable
                  style={alarmRinging ? styles.alarmStopBtn : styles.alarmTestBtn}
                  onPress={toggleTestAlarm}>
                  <Text style={styles.alarmBtnText}>
                    {alarmRinging ? '🔕 Stop alarm' : '🚨 Test alarm (D-006)'}
                  </Text>
                </Pressable>
              </>
            )}
          </>
        ) : (
          <TripScreen stations={stations} options={options} testAlarmState={alarmRinging} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' } as ViewStyle,
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  } as ViewStyle,
  tab: { flex: 1, padding: 12, alignItems: 'center' } as ViewStyle,
  tabOn: { borderBottomWidth: 2, borderBottomColor: '#0057B7' } as ViewStyle,
  tabText: { fontSize: 14, fontWeight: '600', color: '#888' } as TextStyle,
  tabTextOn: { fontWeight: '700', color: '#0057B7' } as TextStyle,
  content: { padding: 16 } as ViewStyle,
  header: { fontSize: 22, fontWeight: '700', color: '#111' } as TextStyle,
  sub: {
    fontSize: 12,
    color: '#777',
    marginBottom: 12,
    marginTop: 4,
    lineHeight: 17,
  } as TextStyle,
  label: { fontSize: 13, color: '#333', marginTop: 12, marginBottom: 4 } as TextStyle,
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#f7f7f7',
    fontSize: 16,
    color: '#111',
  } as ViewStyle,
  suggestBox: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderTopWidth: 0,
    borderRadius: 8,
    backgroundColor: '#fff',
  } as ViewStyle,
  suggestRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  } as ViewStyle,
  suggestText: { fontSize: 15, color: '#111' } as TextStyle,
  card: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  } as ViewStyle,
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' } as TextStyle,
  summary: { fontSize: 14, color: '#333', marginVertical: 6 } as TextStyle,
  legs: { marginTop: 4, gap: 6 } as ViewStyle,
  leg: { flexDirection: 'row', alignItems: 'center', gap: 8 } as ViewStyle,
  legText: { fontSize: 14, color: '#555', flex: 1 } as TextStyle,
  note: { fontSize: 13, color: '#888', marginTop: 10, lineHeight: 17 } as TextStyle,
  chip: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  } as ViewStyle,
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' } as TextStyle,
  bufferRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 } as ViewStyle,
  bufferLabel: { fontSize: 14, color: '#333' } as TextStyle,
  bufferChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  } as ViewStyle,
  bufferChipOn: { backgroundColor: '#0057B7', borderColor: '#0057B7' } as ViewStyle,
  bufferText: { fontSize: 13, color: '#333' } as TextStyle,
  bufferTextOn: { color: '#fff', fontWeight: '700' } as TextStyle,
  primaryBtn: {
    marginTop: 20,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#0057B7',
    alignItems: 'center',
  } as ViewStyle,
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' } as TextStyle,
  stopTripBtn: { marginTop: 10, backgroundColor: '#666' } as ViewStyle,
  tripCard: {
    marginTop: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  } as ViewStyle,
  tripState: { fontSize: 18, fontWeight: '700', color: '#111' } as TextStyle,
  tripBig: { fontSize: 34, fontWeight: '800', color: '#0057B7', marginTop: 8 } as TextStyle,
  tripSub: { fontSize: 14, color: '#555', marginTop: 8, lineHeight: 20 } as TextStyle,
  alarmTestBtn: {
    marginTop: 20,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#d32f2f',
    alignItems: 'center',
  } as ViewStyle,
  alarmStopBtn: {
    marginTop: 20,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#555',
    alignItems: 'center',
  } as ViewStyle,
  alarmBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' } as TextStyle,
  pickerActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 4,
  } as ViewStyle,
  quickActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  } as ViewStyle,
  quickActionText: {
    fontSize: 13,
    color: '#0057B7',
    fontWeight: '600',
  } as TextStyle,
  alarmActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  } as ViewStyle,
  snoozeBtn: {
    flex: 1,
    backgroundColor: '#d97706',
    marginTop: 0,
  } as ViewStyle,
  silenceBtn: {
    flex: 1,
    backgroundColor: '#4b5563',
    marginTop: 0,
  } as ViewStyle,
});

export default App;

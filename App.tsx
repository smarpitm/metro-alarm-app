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

/* ── Theme tokens ──────────────────────────────────────────────────── */

type Theme = {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  red: string;
  dangerSoft: string;
  green: string;
  amber: string;
  dotBorder: string;
};

const DARK: Theme = {
  bg: '#0b0f1a',
  surface: '#151b2c',
  surface2: '#1d2539',
  border: 'rgba(255,255,255,0.08)',
  text: '#eef2fb',
  textDim: '#8b93a7',
  textFaint: '#5b6274',
  accent: '#3d7bff',
  accentSoft: 'rgba(61,123,255,0.15)',
  onAccent: '#ffffff',
  red: '#e5484d',
  dangerSoft: '#2a1116',
  green: '#2e7d32',
  amber: '#e8a33d',
  dotBorder: '#0b0f1a',
};

const LIGHT: Theme = {
  bg: '#f6f8fc',
  surface: '#ffffff',
  surface2: '#eef1f7',
  border: 'rgba(10,20,40,0.10)',
  text: '#101728',
  textDim: '#5a6478',
  textFaint: '#98a1b3',
  accent: '#2563eb',
  accentSoft: 'rgba(37,99,235,0.12)',
  onAccent: '#ffffff',
  red: '#d3383d',
  dangerSoft: '#fdecec',
  green: '#2e7d32',
  amber: '#b45309',
  dotBorder: '#ffffff',
};

/* ── Shared primitives ────────────────────────────────────────────── */

function Button(props: {
  t: Theme;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'muted' | 'warning';
  disabled?: boolean;
  noTopMargin?: boolean;
}) {
  const variant = props.variant ?? 'primary';
  const bg = {
    primary: props.t.accent,
    ghost: 'transparent',
    danger: props.t.red,
    muted: props.t.surface2,
    warning: props.t.amber,
  }[variant];
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'ghost' && styles.btnGhost,
        props.noTopMargin && styles.btnNoMargin,
        { backgroundColor: bg },
        props.disabled && styles.btnDisabled,
        pressed && styles.btnPressed,
      ]}>
      <Text
        style={[
          styles.btnText,
          { color: variant === 'ghost' ? props.t.accent : props.t.onAccent },
        ]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Type-to-search station picker with auto-complete suggestions. */
function TypeaheadPicker(props: {
  t: Theme;
  label: string;
  value: string;
  options: Map<string, string>;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const t = props.t;

  const filtered = useMemo(() => {
    const all = [...props.options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    if (!query.trim()) return all.slice(0, 12);
    const q = query.trim().toLowerCase();
    return all.filter(([, name]) => name.toLowerCase().includes(q)).slice(0, 12);
  }, [props.options, query]);

  return (
    <View>
      <Text style={[styles.label, { color: t.textDim }]}>{props.label}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: t.surface, borderColor: t.border, color: t.text },
        ]}
        value={open ? query : (props.options.get(props.value) ?? '')}
        placeholder="Type station name…"
        placeholderTextColor={t.textFaint}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChangeText={setQuery}
      />
      {open ? (
        <View
          style={[
            styles.suggestBox,
            { backgroundColor: t.surface2, borderColor: t.border },
          ]}>
          <ScrollView style={styles.suggestScroll} keyboardShouldPersistTaps="handled">
            {filtered.map(([id, name]) => (
              <Pressable
                key={id}
                style={({ pressed }) => [
                  styles.suggestRow,
                  { borderBottomColor: t.border },
                  (id === props.value || pressed) && { backgroundColor: t.accent },
                ]}
                onPress={() => {
                  props.onChange(id);
                  setOpen(false);
                }}>
                <Text
                  style={[
                    styles.suggestText,
                    { color: id === props.value || open ? t.text : t.text },
                  ]}
                  numberOfLines={1}>
                  {name}
                </Text>
              </Pressable>
            ))}
            {filtered.length === 0 ? (
              <Text style={[styles.suggestEmpty, { color: t.textDim }]}>
                No station matches “{query}”
              </Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/* ── Route card with colored stage timeline ────────────────────────── */

function RouteCard(props: {
  t: Theme;
  title: string;
  plan: Plan | null;
  note?: string;
}) {
  const t = props.t;
  if (!props.plan) {
    return null;
  }
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: t.border },
      ]}>
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, { color: t.text }]}>{props.title}</Text>
        <View style={styles.cardMeta}>
          <Text style={[styles.cardMetaBig, { color: t.accent }]}>
            {fmtMin(props.plan.timeS)}
          </Text>
          <Text style={[styles.cardMetaDim, { color: t.textDim }]}>
            {props.plan.stationCount} stops ·{' '}
            {props.plan.changes === 0
              ? 'no change'
              : `${props.plan.changes} ${props.plan.changes === 1 ? 'change' : 'changes'}`}
          </Text>
        </View>
      </View>
      <View style={styles.timeline}>
        {props.plan.legs.map((leg, i) => (
          <View key={i} style={styles.leg}>
            <View
              style={[
                styles.legRail,
                { borderLeftColor: LINE_COLORS[leg.lineId] ?? '#667' },
              ]}>
              <View style={styles.legStationRow}>
                <View
                  style={[
                    styles.legDot,
                    {
                      borderColor: LINE_COLORS[leg.lineId] ?? '#667',
                      backgroundColor: t.dotBorder,
                    },
                  ]}
                />
                <Text style={[styles.legStation, { color: t.text }]} numberOfLines={1}>
                  {leg.boardName}
                </Text>
              </View>
              <View style={styles.legStationRow}>
                <Text style={[styles.legStops, { color: t.textFaint }]}>
                  {leg.stations.length > 2 ? `${leg.stations.length - 2} stops` : 'direct'}
                </Text>
              </View>
              <View style={styles.legStationRow}>
                <View
                  style={[styles.legDotEnd, { backgroundColor: t.textDim }]}
                />
                <Text style={[styles.legStation, { color: t.text }]} numberOfLines={1}>
                  {leg.alightName}
                </Text>
              </View>
            </View>
            {i < props.plan!.legs.length - 1 ? (
              <View style={styles.transferRow}>
                <Text style={[styles.transferText, { color: t.amber }]}>↓ interchange</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {props.note ? <Text style={[styles.note, { color: t.textDim }]}>{props.note}</Text> : null}
    </View>
  );
}

/* ── Trip screen ───────────────────────────────────────────────────── */

function TripScreen(props: {
  t: Theme;
  stations: Map<string, string>;
  options: string[];
  testAlarmState: boolean;
}) {
  const t = props.t;
  const stations = props.stations;
  const [enteredAt, setEnteredAt] = useState('dwarka-sector-21');
  const [dest, setDest] = useState('noida-electronic-city');
  const [buffer, setBuffer] = useState<1 | 2>(1);
  const [locating, setLocating] = useState(false);
  const [snap, setSnap] = useState<TripSnapshot>({
    state: 'idle',
    lastStation: null,
    stopsRemaining: null,
    distM: null,
    etaS: null,
  });
  const [walkCountdown, setWalkCountdown] = useState<number | null>(null);
  const trip = useRef<TripController | null>(null);

  /** Demo-mode toggle for the native alarm (no GPS needed). */
  const toggleTestAlarm = async () => {
    const isRinging = await MetroAlarm.isRinging();
    if (isRinging) {
      await MetroAlarm.stopAlarm();
    } else {
      await MetroAlarm.requestNotificationPermission();
      await MetroAlarm.startAlarm();
    }
  };

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('MetroTripLocation', fix => {
      trip.current?.onFix(fix);
    });
    return () => {
      sub.remove();
      trip.current?.cancel();
    };
  }, []);

  /** Walk-to-exit countdown: when the train arrives at the destination,
   * start a 90-second timer so the rider can gather things and reach the exit. */
  useEffect(() => {
    if (snap.state !== 'done') {
      setWalkCountdown(null);
      return;
    }
    setWalkCountdown(90);
    const t = setInterval(() => {
      setWalkCountdown(c => (c != null && c > 0 ? c - 1 : null));
    }, 1000);
    (t as any).unref?.();
    return () => clearInterval(t);
  }, [snap.state]);

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

  if (snap.state === 'idle') {
    return (
      <View>
        <Text style={[styles.sub, { color: t.textDim }]}>
          Boarded the metro? Tell us where — the alarm fires {buffer} stop(s) before your
          station, even with the screen off.
        </Text>
        <TypeaheadPicker
          t={t}
          label="I entered at"
          value={enteredAt}
          options={stations}
          onChange={setEnteredAt}
        />
        <View style={styles.pickerActionRow}>
          <Button
            t={t}
            variant="ghost"
            noTopMargin
            label={locating ? '◎ Locating…' : '◎ Auto-detect origin'}
            onPress={autoDetectOrigin}
            disabled={locating}
          />
          <Button t={t} variant="ghost" noTopMargin label="⇅ Swap" onPress={swapStations} />
        </View>
        <TypeaheadPicker
          t={t}
          label="Going to"
          value={dest}
          options={stations}
          onChange={setDest}
        />
        <Text style={[styles.label, { color: t.textDim }]}>Alarm before destination</Text>
        <View style={styles.bufferRow}>
          {[1, 2].map(n => (
            <Pressable
              key={n}
              style={[
                styles.bufferChip,
                { backgroundColor: t.surface, borderColor: t.border },
                buffer === n && { backgroundColor: t.accent, borderColor: t.accent },
              ]}
              onPress={() => setBuffer(n as 1 | 2)}>
              <Text
                style={[
                  styles.bufferText,
                  { color: buffer === n ? t.onAccent : t.textDim },
                ]}>
                {n} stop{n > 1 ? 's' : ''} early
              </Text>
            </Pressable>
          ))}
        </View>
        <Button t={t} label="Start trip" onPress={startTrip} />
        <Button
          t={t}
          variant="ghost"
          noTopMargin
          label="🔊 Test alarm (native)"
          onPress={toggleTestAlarm}
        />
        <Text style={[styles.note, { color: t.textDim }]}>
          GPS anchor above ground + timing estimates underground drive the countdown.
          Works with the phone locked and the app in the background.
        </Text>
      </View>
    );
  }

  const alarmed = snap.state === 'alarmed';
  const done = snap.state === 'done';
  const stops = snap.stopsRemaining != null ? Math.max(0, Math.ceil(snap.stopsRemaining)) : null;

  return (
    <View
      style={[
        styles.tripCard,
        { backgroundColor: t.surface, borderColor: t.border },
        alarmed && { borderColor: t.red, backgroundColor: t.dangerSoft },
        done && { borderColor: t.green },
      ]}>
      <View
        style={[
          styles.statusPill,
          { backgroundColor: t.accentSoft },
          alarmed && { backgroundColor: t.red },
        ]}>
        <Text
          style={[
            styles.statusPillText,
            { color: t.accent },
            alarmed && { color: t.onAccent },
          ]}>
          {alarmed
            ? '● ALARM — get off soon'
            : done
              ? '● Arrived'
              : '● Riding'}
        </Text>
      </View>
      <Text style={[styles.tripBig, { color: t.text }]}>
        {done ? '✓' : stops != null ? stops : '…'}
        {!done ? (
          <Text style={[styles.tripBigUnit, { color: t.textDim }]}>
            {' '}
            {stops === 1 ? 'stop' : 'stops'} left
          </Text>
        ) : null}
      </Text>
      {stops == null && !done ? (
        <Text style={[styles.tripHint, { color: t.textDim }]}>waiting for GPS anchor</Text>
      ) : null}
      <View style={styles.tripStats}>
        {snap.lastStation ? (
          <View style={styles.tripStat}>
            <Text style={[styles.tripStatLabel, { color: t.textFaint }]}>last confirmed</Text>
            <Text style={[styles.tripStatValue, { color: t.text }]} numberOfLines={1}>
              {snap.lastStation}
            </Text>
          </View>
        ) : null}
        {snap.distM != null ? (
          <View style={styles.tripStat}>
            <Text style={[styles.tripStatLabel, { color: t.textFaint }]}>distance</Text>
            <Text style={[styles.tripStatValue, { color: t.text }]}>
              {Math.round(snap.distM)} m
            </Text>
          </View>
        ) : null}
        {snap.etaS != null ? (
          <View style={styles.tripStat}>
            <Text style={[styles.tripStatLabel, { color: t.textFaint }]}>eta</Text>
            <Text style={[styles.tripStatValue, { color: t.text }]}>{fmtMin(snap.etaS)}</Text>
          </View>
        ) : null}
      </View>
      {done && walkCountdown != null && walkCountdown > 0 ? (
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: t.text }]}>🚶 Walk to exit</Text>
          <Text style={[styles.tripBig, { color: t.accent }]}>
            {walkCountdown}s
          </Text>
          <Text style={[styles.tripHint, { color: t.textDim }]}>
            Gather your things and head to the exit before the doors close.
          </Text>
          <Button t={t} variant="ghost" noTopMargin label="End walk countdown" onPress={() => setWalkCountdown(null)} />
        </View>
      ) : null}
      {alarmed ? (
        <View style={styles.alarmActionRow}>
          <Button t={t} variant="warning" noTopMargin label="Snooze 3m" onPress={snoozeAlarm} />
          <Button t={t} variant="muted" noTopMargin label="Silence alarm" onPress={dismissAlarm} />
        </View>
      ) : null}
      <Button t={t} variant="ghost" noTopMargin label="End trip" onPress={cancelTrip} />
    </View>
  );
}

/* ── App ───────────────────────────────────────────────────────────── */

function App(): React.JSX.Element {
  const stations = useMemo(() => collectStations(delhiNetwork), []);
  const options = useMemo(() => Array.from(stations.keys()), [stations]);

  const [mode, setMode] = useState<'planner' | 'trip'>('planner');
  const [isDark, setIsDark] = useState(true);
  const t = isDark ? DARK : LIGHT;
  const [origin, setOrigin] = useState('dwarka-sector-21');
  const [dest, setDest] = useState('noida-electronic-city');
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
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <Text style={[styles.appTitle, { color: t.text }]}>Metro Alarm</Text>
        <Pressable
          onPress={() => setIsDark(v => !v)}
          style={({ pressed }) => [
            styles.themeToggle,
            { backgroundColor: t.surface, borderColor: t.border },
            pressed && styles.btnPressed,
          ]}>
          <Text style={[styles.themeToggleIcon, { color: t.text }]}>{isDark ? '☀' : '☾'}</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {(['planner', 'trip'] as const).map(m => (
          <Pressable
            key={m}
            style={({ pressed }) => [
              styles.tab,
              { backgroundColor: t.surface },
              mode === m && { backgroundColor: t.accent },
              pressed && styles.tabPressed,
            ]}
            onPress={() => setMode(m)}>
            <Text
              style={[
                styles.tabText,
                { color: t.textDim },
                mode === m && { color: t.onAccent },
              ]}>
              {m === 'planner' ? 'Planner' : 'Trip alarm'}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        {mode === 'planner' ? (
          <>
            <Text style={[styles.header, { color: t.text }]}>Route planner</Text>
            <Text style={[styles.sub, { color: t.textDim }]}>
              Delhi Metro · {options.length} stations · fully offline
            </Text>
            <TypeaheadPicker t={t} label="From" value={origin} options={stations} onChange={setOrigin} />
            <TypeaheadPicker t={t} label="To" value={dest} options={stations} onChange={setDest} />
            {origin === dest ? (
              <Text style={[styles.note, { color: t.textDim }]}>
                Pick two different stations.
              </Text>
            ) : (
              <>
                <RouteCard t={t} title="Fastest" plan={fastest} />
                <RouteCard t={t} title="Fewest changes" plan={leastChanges} />
                {identical ? (
                  <Text style={[styles.note, { color: t.textDim }]}>
                    Both routes match — origin and destination share one line.
                  </Text>
                ) : null}
                <Button
                  t={t}
                  variant={alarmRinging ? 'muted' : 'danger'}
                  label={alarmRinging ? 'Stop alarm' : 'Test alarm (D-006)'}
                  onPress={toggleTestAlarm}
                />
              </>
            )}
          </>
        ) : (
          <TripScreen t={t} stations={stations} options={options} testAlarmState={alarmRinging} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Styles (layout only; colors are per-theme) ────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1 } as ViewStyle,
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
  } as ViewStyle,
  appTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  } as TextStyle,
  themeToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  themeToggleIcon: { fontSize: 16, fontWeight: '700' } as TextStyle,
  tabs: {
    flexDirection: 'row',
    margin: 12,
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 4,
    gap: 4,
  } as ViewStyle,
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 9,
  } as ViewStyle,
  tabPressed: { opacity: 0.85 } as ViewStyle,
  tabText: { fontSize: 14, fontWeight: '600' } as TextStyle,
  content: { padding: 16, paddingBottom: 40 } as ViewStyle,
  header: { fontSize: 26, fontWeight: '800' } as TextStyle,
  sub: {
    fontSize: 13,
    marginBottom: 16,
    marginTop: 4,
    lineHeight: 19,
  } as TextStyle,
  label: {
    fontSize: 12,
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '600',
  } as TextStyle,
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  } as unknown as ViewStyle,
  suggestBox: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 6,
    overflow: 'hidden',
  } as ViewStyle,
  suggestScroll: { maxHeight: 280 } as ViewStyle,
  suggestRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  } as ViewStyle,
  suggestText: { fontSize: 15 } as TextStyle,
  suggestEmpty: { padding: 14, fontSize: 14 } as TextStyle,
  btn: {
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  } as ViewStyle,
  btnGhost: { borderWidth: 1, borderColor: 'transparent' } as ViewStyle,
  btnNoMargin: { marginTop: 0 } as ViewStyle,
  btnPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] } as ViewStyle,
  btnDisabled: { opacity: 0.5 } as ViewStyle,
  btnText: { fontSize: 15, fontWeight: '700' } as TextStyle,
  card: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  } as ViewStyle,
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  } as ViewStyle,
  cardTitle: { fontSize: 17, fontWeight: '700' } as TextStyle,
  cardMeta: { alignItems: 'flex-end' } as ViewStyle,
  cardMetaBig: { fontSize: 20, fontWeight: '800' } as TextStyle,
  cardMetaDim: { fontSize: 12, marginTop: 2 } as TextStyle,
  timeline: { marginTop: 14, gap: 4 } as ViewStyle,
  leg: {} as ViewStyle,
  legRail: { borderLeftWidth: 3, paddingLeft: 14, marginLeft: 4 } as ViewStyle,
  legStationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  } as ViewStyle,
  legDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
  } as ViewStyle,
  legDotEnd: { width: 8, height: 8, borderRadius: 4 } as ViewStyle,
  legStation: { fontSize: 15, fontWeight: '600', flexShrink: 1 } as TextStyle,
  legStops: { fontSize: 12, marginLeft: 22 } as TextStyle,
  transferRow: { paddingLeft: 22, paddingVertical: 6 } as ViewStyle,
  transferText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  } as TextStyle,
  note: { fontSize: 13, marginTop: 12, lineHeight: 19 } as TextStyle,
  pickerActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  } as ViewStyle,
  bufferRow: { flexDirection: 'row', gap: 8 } as ViewStyle,
  bufferChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  } as ViewStyle,
  bufferText: { fontSize: 13, fontWeight: '600' } as TextStyle,
  tripCard: {
    marginTop: 12,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'flex-start',
  } as ViewStyle,
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  } as ViewStyle,
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  } as TextStyle,
  tripBig: { fontSize: 56, fontWeight: '900', marginTop: 10 } as TextStyle,
  tripBigUnit: { fontSize: 18, fontWeight: '600' } as TextStyle,
  tripHint: { fontSize: 13, marginTop: 4, fontStyle: 'italic' } as TextStyle,
  tripStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 14,
    alignSelf: 'stretch',
  } as ViewStyle,
  tripStat: { minWidth: 90 } as ViewStyle,
  tripStatLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  } as TextStyle,
  tripStatValue: { fontSize: 15, fontWeight: '600', marginTop: 2 } as TextStyle,
  alarmActionRow: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'stretch',
    marginTop: 6,
  } as ViewStyle,
});

export default App;

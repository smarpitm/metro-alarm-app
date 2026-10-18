import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import { blueLineNetwork, collectStations } from './src/metro/data';
import type { Plan } from './src/metro/planner';
import { planFastest, planLeastChanges } from './src/metro/planner';
import { MetroAlarm } from './src/native/MetroAlarm';

const fmtMin = (seconds: number) => `${Math.round(seconds / 60)} min`;

function StationPicker(props: {
  label: string;
  value: string;
  options: string[];
  names: Map<string, string>;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Text style={styles.label}>{props.label}</Text>
      <Pressable style={styles.pickerBox} onPress={() => setOpen(true)}>
        <Text style={styles.pickerText}>{props.names.get(props.value)}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.sheet}>
          <FlatList
            data={props.options}
            keyExtractor={id => id}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => {
                  props.onChange(item);
                  setOpen(false);
                }}>
                <Text style={styles.rowText}>{props.names.get(item)}</Text>
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
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
      {props.plan.legs.map((leg, i) => (
        <Text key={i} style={styles.leg}>
          {leg.lineName}: {leg.boardName} → {leg.alightName}
        </Text>
      ))}
      {props.note ? <Text style={styles.note}>{props.note}</Text> : null}
    </View>
  );
}

function App(): React.JSX.Element {
  const stations = useMemo(() => collectStations(blueLineNetwork), []);
  const options = useMemo(
    () => Array.from(stations.keys()).sort((a, b) => (stations.get(a) ?? '').localeCompare(stations.get(b) ?? '')),
    [stations],
  );
  const [origin, setOrigin] = useState('dwarka-sector-21');
  const [dest, setDest] = useState('noida-electronic-city');
  const [alarmRinging, setAlarmRinging] = useState(false);

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

  const fastest = useMemo(
    () => (origin !== dest ? planFastest(blueLineNetwork, origin, dest) : null),
    [origin, dest],
  );
  const leastChanges = useMemo(
    () => (origin !== dest ? planLeastChanges(blueLineNetwork, origin, dest) : null),
    [origin, dest],
  );
  const identical =
    fastest != null &&
    leastChanges != null &&
    fastest.changes === leastChanges.changes &&
    fastest.timeS === leastChanges.timeS;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Metro Route Planner</Text>
        <Text style={styles.sub}>Data pack v0: Blue Line (placeholder times)</Text>

        <StationPicker
          label="From"
          value={origin}
          options={options}
          names={stations}
          onChange={setOrigin}
        />
        <StationPicker
          label="To"
          value={dest}
          options={options}
          names={stations}
          onChange={setDest}
        />

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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' } as ViewStyle,
  content: { padding: 16 } as ViewStyle,
  header: { fontSize: 22, fontWeight: '700', color: '#111' } as TextStyle,
  sub: { fontSize: 12, color: '#777', marginBottom: 12 } as TextStyle,
  label: { fontSize: 13, color: '#333', marginTop: 12, marginBottom: 4 } as TextStyle,
  pickerBox: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#f7f7f7',
  } as ViewStyle,
  pickerText: { fontSize: 16, color: '#111' } as TextStyle,
  sheet: { flex: 1, backgroundColor: '#fff', padding: 16 } as ViewStyle,
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' } as ViewStyle,
  rowText: { fontSize: 16, color: '#111' } as TextStyle,
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
  leg: { fontSize: 14, color: '#555', marginTop: 2 } as TextStyle,
  note: { fontSize: 13, color: '#888', marginTop: 10 } as TextStyle,
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
});

export default App;

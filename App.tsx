import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import type { Plan } from './src/metro/planner';
import { planAlternates, planFastest, planLeastChanges } from './src/metro/planner';
import { LINE_COLORS, collectStationsWithCoords, delhiNetwork } from './src/metro/delhiNetwork';
import { collectStations } from './src/metro/data';
import { MetroAlarm } from './src/native/MetroAlarm';
import { TripController, hav } from './src/trip/TripController';
import type { AlarmAlertMode, TripSnapshot } from './src/trip/TripController';

const fmtMin = (seconds: number) => `${Math.round(seconds / 60)} min`;

/* ── Theme tokens (Rich Dark & Light Mode) ─────────────────────────── */

type Theme = {
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
  dangerSoft: string;
  green: string;
  greenSoft: string;
  amber: string;
  amberSoft: string;
  dotBorder: string;
};

const DARK: Theme = {
  bg: '#0b0f19',
  surface: '#141c2e',
  surface2: '#1e293b',
  surfaceElevated: '#243048',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',
  text: '#f8fafc',
  textDim: '#94a3b8',
  textFaint: '#64748b',
  accent: '#3b82f6',
  accentSoft: 'rgba(59,130,246,0.18)',
  onAccent: '#ffffff',
  red: '#ef4444',
  dangerSoft: 'rgba(239,68,68,0.16)',
  green: '#10b981',
  greenSoft: 'rgba(16,185,129,0.16)',
  amber: '#f59e0b',
  amberSoft: 'rgba(245,158,11,0.16)',
  dotBorder: '#141c2e',
};

const LIGHT: Theme = {
  bg: '#f8fafc',
  surface: '#ffffff',
  surface2: '#f1f5f9',
  surfaceElevated: '#e2e8f0',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  text: '#0f172a',
  textDim: '#475569',
  textFaint: '#94a3b8',
  accent: '#2563eb',
  accentSoft: 'rgba(37,99,235,0.10)',
  onAccent: '#ffffff',
  red: '#dc2626',
  dangerSoft: '#fef2f2',
  green: '#059669',
  greenSoft: '#ecfdf5',
  amber: '#d97706',
  amberSoft: '#fffbeb',
  dotBorder: '#ffffff',
};

/* ── Shared primitives ────────────────────────────────────────────── */

function Button(props: {
  t: Theme;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'muted' | 'warning' | 'success';
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
    success: props.t.green,
  }[variant];
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'ghost' && [styles.btnGhost, { borderColor: props.t.border }],
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

/** Type-to-search station picker with quick search filter & clear button. */
function TypeaheadPicker(props: {
  t: Theme;
  label: string;
  value: string;
  options: Map<string, string>;
  onChange: (id: string) => void;
  placeholder?: string;
  onClear?: () => void;
}) {
  const currentName = props.options.get(props.value) ?? '';
  const [query, setQuery] = useState(currentName);
  const [open, setOpen] = useState(false);
  const t = props.t;

  // Sync query when props.value changes externally
  useEffect(() => {
    if (!open) {
      setQuery(props.options.get(props.value) ?? '');
    }
  }, [props.value, props.options, open]);

  const filtered = useMemo(() => {
    const all = [...props.options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 16);
    return all.filter(([, name]) => name.toLowerCase().includes(q)).slice(0, 20);
  }, [props.options, query]);

  const handleClear = () => {
    props.onChange('');
    setQuery('');
    setOpen(true);
    props.onClear?.();
  };

  return (
    <View style={styles.pickerWrapper}>
      <View style={styles.pickerLabelRow}>
        <Text style={[styles.label, { color: t.textDim }]}>{props.label}</Text>
        {props.value ? (
          <Pressable onPress={handleClear} hitSlop={8}>
            <Text style={[styles.clearLinkText, { color: t.accent }]}>✕ Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={[
          styles.inputContainer,
          { backgroundColor: t.surface, borderColor: open ? t.accent : t.border },
        ]}>
        <TextInput
          style={[styles.inputField, { color: t.text }]}
          value={open ? query : (props.options.get(props.value) ?? '')}
          placeholder={props.placeholder ?? 'Type station name…'}
          placeholderTextColor={t.textFaint}
          onFocus={() => {
            setOpen(true);
            setQuery(props.options.get(props.value) ?? '');
          }}
          onChangeText={setQuery}
        />
        {props.value || (open && query.length > 0) ? (
          <Pressable onPress={handleClear} style={styles.inputClearBtn} hitSlop={10}>
            <Text style={[styles.inputClearText, { color: t.textDim }]}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View
          style={[
            styles.suggestBox,
            { backgroundColor: t.surface, borderColor: t.borderStrong },
          ]}>
          <View style={[styles.suggestHeader, { borderBottomColor: t.border }]}>
            <Text style={[styles.suggestHeaderTitle, { color: t.textDim }]}>
              {query.trim() ? `Matching Stations (${filtered.length})` : 'Popular & All Stations'}
            </Text>
            <Pressable
              onPress={() => {
                setOpen(false);
                setQuery(props.options.get(props.value) ?? '');
              }}
              hitSlop={8}>
              <Text style={[styles.suggestCloseText, { color: t.accent }]}>Done ✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.suggestScroll} keyboardShouldPersistTaps="handled">
            {filtered.map(([id, name]) => (
              <Pressable
                key={id}
                style={({ pressed }) => [
                  styles.suggestRow,
                  { borderBottomColor: t.border },
                  (id === props.value || pressed) && { backgroundColor: t.accentSoft },
                ]}
                onPress={() => {
                  props.onChange(id);
                  setQuery(name);
                  setOpen(false);
                }}>
                <Text
                  style={[
                    styles.suggestText,
                    { color: id === props.value ? t.accent : t.text },
                    id === props.value && styles.suggestTextActive,
                  ]}
                  numberOfLines={1}>
                  {id === props.value ? '✓ ' : '  '}
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

/** Alarm Alert Mode Selector (Sound + Vibrate / Vibration Only / Silent). */
function AlertModeSelector(props: {
  t: Theme;
  alertMode: AlarmAlertMode;
  onChange: (mode: AlarmAlertMode) => void;
}) {
  const t = props.t;
  const modes: { id: AlarmAlertMode; icon: string; title: string; subtitle: string }[] = [
    { id: 'sound', icon: '🔊', title: 'Sound & Vibrate', subtitle: 'Loud alarm tone' },
    { id: 'vibration', icon: '📳', title: 'Vibration Only', subtitle: 'Strong buzz, no audio' },
    { id: 'silent', icon: '🔕', title: 'Silent Alert', subtitle: 'Visual banner only' },
  ];

  return (
    <View style={styles.alertModeContainer}>
      <Text style={[styles.label, { color: t.textDim }]}>Alarm Alert Mode</Text>
      <View style={styles.alertModeRow}>
        {modes.map(m => {
          const active = props.alertMode === m.id;
          return (
            <Pressable
              key={m.id}
              style={[
                styles.alertModeChip,
                { backgroundColor: t.surface2, borderColor: t.border },
                active && { borderColor: t.accent, backgroundColor: t.accentSoft },
              ]}
              onPress={() => props.onChange(m.id)}>
              <Text style={styles.alertModeIcon}>{m.icon}</Text>
              <Text
                style={[
                  styles.alertModeTitle,
                  { color: active ? t.accent : t.text },
                  active && styles.alertModeTitleActive,
                ]}>
                {m.title}
              </Text>
              <Text style={[styles.alertModeSub, { color: t.textFaint }]}>{m.subtitle}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── Route card with colored stage timeline ────────────────────────── */

function RouteCard(props: {
  t: Theme;
  title: string;
  plan: Plan | null;
  note?: string;
  isPrimary?: boolean;
  onSetAlarm?: () => void;
}) {
  const t = props.t;
  if (!props.plan) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: props.isPrimary ? t.accent : t.border },
      ]}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.cardTitle, { color: t.text }]}>{props.title}</Text>
          {props.plan.interchangeSummary ? (
            <View
              style={[
                styles.interchangeBadge,
                { backgroundColor: props.plan.changes === 0 ? t.greenSoft : t.amberSoft },
              ]}>
              <Text
                style={[
                  styles.interchangeBadgeText,
                  { color: props.plan.changes === 0 ? t.green : t.amber },
                ]}>
                {props.plan.changes === 0 ? '🟢 Direct Route' : `🔄 ${props.plan.interchangeSummary}`}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cardMeta}>
          <Text style={[styles.cardMetaBig, { color: t.accent }]}>
            {fmtMin(props.plan.timeS)}
          </Text>
          <Text style={[styles.cardMetaDim, { color: t.textDim }]}>
            {props.plan.stationCount} stops ·{' '}
            {props.plan.changes === 0
              ? 'direct'
              : `${props.plan.changes} ${props.plan.changes === 1 ? 'transfer' : 'transfers'}`}
          </Text>
        </View>
      </View>
      <View style={styles.timeline}>
        {props.plan.legs.map((leg, i) => (
          <View key={i} style={styles.leg}>
            <View
              style={[
                styles.legRail,
                { borderLeftColor: LINE_COLORS[leg.lineId] ?? props.t.accent },
              ]}>
              <View style={styles.legStationRow}>
                <View
                  style={[
                    styles.legDot,
                    {
                      borderColor: LINE_COLORS[leg.lineId] ?? props.t.accent,
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
                  {leg.stations.length > 2 ? `${leg.stations.length - 2} intermediate stops` : 'direct run'}
                </Text>
              </View>
              <View style={styles.legStationRow}>
                <View style={[styles.legDotEnd, { backgroundColor: t.textDim }]} />
                <Text style={[styles.legStation, { color: t.text }]} numberOfLines={1}>
                  {leg.alightName}
                </Text>
              </View>
            </View>
            {i < props.plan!.legs.length - 1 ? (
              <View style={styles.transferRow}>
                <Text style={[styles.transferText, { color: t.amber }]}>↓ change line at {leg.alightName}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {props.note ? <Text style={[styles.note, { color: t.textDim }]}>{props.note}</Text> : null}
      {props.onSetAlarm ? (
        <Button
          t={t}
          variant="primary"
          noTopMargin
          label="🚀 Set Alarm for this Route"
          onPress={props.onSetAlarm}
        />
      ) : null}
    </View>
  );
}

/* ── Route Options Selector (Possible 2 routes / interchange choices) ── */

function RouteOptionsSelector(props: {
  t: Theme;
  routes: Plan[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  const t = props.t;
  if (props.routes.length === 0) return null;

  return (
    <View style={styles.routeSelectorWrap}>
      <Text style={[styles.label, { color: t.textDim }]}>
        Route & Interchange Options ({props.routes.length} available)
      </Text>
      <View style={styles.routeCardsRow}>
        {props.routes.map((p, idx) => {
          const isSelected = props.selectedIdx === idx;
          const isFastest = idx === 0;
          return (
            <Pressable
              key={idx}
              style={[
                styles.routeOptionCard,
                { backgroundColor: t.surface2, borderColor: t.border },
                isSelected && { borderColor: t.accent, backgroundColor: t.accentSoft },
              ]}
              onPress={() => props.onSelect(idx)}>
              <View style={styles.routeOptionHead}>
                <Text
                  style={[
                    styles.routeOptionTitle,
                    { color: isSelected ? t.accent : t.text },
                    isSelected && { fontWeight: '800' },
                  ]}>
                  {isFastest ? '⚡ Route 1 (Fastest)' : `🔄 Route 2 (Alternative Interchange)`}
                </Text>
                {isSelected ? (
                  <View style={[styles.routeBadge, { backgroundColor: t.accent }]}>
                    <Text style={styles.routeBadgeText}>✓ Selected</Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[
                  styles.routeOptionSummary,
                  { color: p.changes === 0 ? t.green : t.amber },
                ]}>
                {p.changes === 0 ? '🟢 Direct Route' : `🔄 ${p.interchangeSummary}`}
              </Text>
              <Text style={[styles.routeOptionMeta, { color: t.textDim }]}>
                ~{fmtMin(p.timeS)} · {p.stationCount} stops · {p.changes === 0 ? '0 transfers' : `${p.changes} transfer`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── Active Trip Banner (Shown in Planner so trip is never lost) ─────── */

function ActiveTripBanner(props: {
  t: Theme;
  snap: TripSnapshot;
  onPress: () => void;
}) {
  const t = props.t;
  const stops = props.snap.stopsRemaining != null ? Math.max(0, Math.ceil(props.snap.stopsRemaining)) : null;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.activeBanner,
        { backgroundColor: t.surface, borderColor: t.green },
        pressed && styles.btnPressed,
      ]}>
      <View style={styles.activeBannerLeft}>
        <View style={[styles.pulsingDot, { backgroundColor: t.green }]} />
        <View>
          <Text style={[styles.activeBannerTitle, { color: t.text }]}>Active Trip in Progress</Text>
          <Text style={[styles.activeBannerSub, { color: t.textDim }]}>
            {stops != null ? `${stops} ${stops === 1 ? 'stop' : 'stops'} left` : 'Tracking GPS…'}
            {props.snap.distM != null ? ` · ${(props.snap.distM / 1000).toFixed(1)} km` : ''}
            {props.snap.etaS != null ? ` · ~${fmtMin(props.snap.etaS)}` : ''}
          </Text>
        </View>
      </View>
      <Text style={[styles.activeBannerAction, { color: t.accent }]}>View ➔</Text>
    </Pressable>
  );
}

/* ── Splash Input Screen ───────────────────────────────────────────── */

interface SavedRide {
  enteredAt: string;
  dest: string;
  buffer: 1 | 2;
}

function SplashInputScreen(props: {
  t: Theme;
  stations: Map<string, string>;
  enteredAt: string;
  setEnteredAt: (id: string) => void;
  dest: string;
  setDest: (id: string) => void;
  buffer: 1 | 2;
  setBuffer: (b: 1 | 2) => void;
  alertMode: AlarmAlertMode;
  setAlertMode: (m: AlarmAlertMode) => void;
  recentRides: SavedRide[];
  routes: Plan[];
  selectedRouteIdx: number;
  onSelectRoute: (idx: number) => void;
  locating: boolean;
  detectMsg: string | null;
  onAutoDetect: () => void;
  onSwap: () => void;
  onStartTrip: () => void;
  onOpenPlanner: () => void;
  onTestAlarm: () => void;
}) {
  const t = props.t;
  const currentPlan = props.routes[props.selectedRouteIdx] ?? props.routes[0];

  return (
    <View style={styles.splashContainer}>
      {/* Hero Branding */}
      <View style={styles.splashHero}>
        <View style={[styles.metroIconRing, { backgroundColor: t.accentSoft, borderColor: t.accent }]}>
          <Image source={require('./assets/icon.png')} style={styles.splashHeroImg} resizeMode="contain" />
        </View>
        <Text style={[styles.splashTitle, { color: t.text }]}>Delhi Metro Alarm</Text>
        <Text style={[styles.splashTagline, { color: t.textDim }]}>
          Never miss your station. Wake up 1–2 stops early even with the screen off.
        </Text>
        <View style={[styles.offlineBadge, { backgroundColor: t.greenSoft, borderColor: t.green }]}>
          <Text style={[styles.offlineBadgeText, { color: t.green }]}>● 100% Offline (No Internet / SIM Needed) · DMRC</Text>
        </View>
      </View>

      {/* Hero Input Card */}
      <View style={[styles.splashCard, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Text style={[styles.splashCardHeading, { color: t.text }]}>Start Your Journey</Text>

        {/* 1. FROM Station (Boarded at) */}
        <TypeaheadPicker
          t={t}
          label="From (Boarded at)"
          placeholder="Origin station…"
          value={props.enteredAt}
          options={props.stations}
          onChange={props.setEnteredAt}
        />

        <View style={styles.pickerActionRow}>
          <Button
            t={t}
            variant="ghost"
            noTopMargin
            label={props.locating ? '◎ Locating…' : '◎ Auto-detect station'}
            onPress={props.onAutoDetect}
            disabled={props.locating}
          />
          <Button t={t} variant="ghost" noTopMargin label="⇅ Swap Stations" onPress={props.onSwap} />
        </View>
        {props.detectMsg ? (
          <Text style={[styles.detectFeedback, { color: t.accent }]}>{props.detectMsg}</Text>
        ) : null}

        {/* 2. TO Station (Destination) */}
        <TypeaheadPicker
          t={t}
          label="To (Destination station)"
          placeholder="Where are you going?"
          value={props.dest}
          options={props.stations}
          onChange={props.setDest}
        />

        {/* 3. Route & Interchange Options (Top 2 routes) */}
        {props.routes.length > 0 && (
          <RouteOptionsSelector
            t={t}
            routes={props.routes}
            selectedIdx={props.selectedRouteIdx}
            onSelect={props.onSelectRoute}
          />
        )}

        <Text style={[styles.label, { color: t.textDim }]}>Alarm trigger timing</Text>
        <View style={styles.bufferRow}>
          {[1, 2].map(n => (
            <Pressable
              key={n}
              style={[
                styles.bufferChip,
                { backgroundColor: t.surface2, borderColor: t.border },
                props.buffer === n && { backgroundColor: t.accent, borderColor: t.accent },
              ]}
              onPress={() => props.setBuffer(n as 1 | 2)}>
              <Text
                style={[
                  styles.bufferText,
                  { color: props.buffer === n ? t.onAccent : t.textDim },
                ]}>
                🔔 {n} stop{n > 1 ? 's' : ''} before destination
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Alarm Alert Mode Selector */}
        <AlertModeSelector
          t={t}
          alertMode={props.alertMode}
          onChange={props.setAlertMode}
        />

        <Button
          t={t}
          variant="primary"
          label={
            currentPlan?.interchangeSummary
              ? `🚀 Start Journey Alarm · ${currentPlan.interchangeSummary}`
              : '🚀 Start Journey Alarm'
          }
          onPress={props.onStartTrip}
        />
      </View>

      {/* Offline Guarantee Banner */}
      <View style={[styles.offlineExplainer, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Text style={[styles.offlineExplainerText, { color: t.textDim }]}>
          📶 <Text style={{ fontWeight: '700', color: t.text }}>Works 100% Offline:</Text> All DMRC line maps, transfer hubs, geofences, and tunnel dead-reckoning run entirely on your phone. No internet or cellular data is ever required.
        </Text>
      </View>

      {/* Recent Trips / Quick Commute */}
      {props.recentRides.length > 0 ? (
        <View style={styles.recentContainer}>
          <Text style={[styles.recentTitle, { color: t.textDim }]}>⚡ Quick Commute / Recent Trips</Text>
          <View style={styles.recentWrap}>
            {props.recentRides.map((r, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [
                  styles.recentChip,
                  { backgroundColor: t.surface, borderColor: t.border },
                  pressed && styles.btnPressed,
                ]}
                onPress={() => {
                  props.setEnteredAt(r.enteredAt);
                  props.setDest(r.dest);
                  props.setBuffer(r.buffer);
                }}>
                <Text style={[styles.recentChipText, { color: t.text }]} numberOfLines={1}>
                  {props.stations.get(r.enteredAt) ?? r.enteredAt} ➔ {props.stations.get(r.dest) ?? r.dest}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Secondary Actions */}
      <View style={styles.splashFootActions}>
        <Button
          t={t}
          variant="muted"
          noTopMargin
          label="🗺 Open Route Planner & Interchange Options"
          onPress={props.onOpenPlanner}
        />
        <Button
          t={t}
          variant="ghost"
          noTopMargin
          label="🔊 Test Alarm Audio"
          onPress={props.onTestAlarm}
        />
      </View>
    </View>
  );
}

/* ── Trip Screen (Active & Idle Ride Management) ────────────────────── */

function TripScreen(props: {
  t: Theme;
  stations: Map<string, string>;
  enteredAt: string;
  setEnteredAt: (id: string) => void;
  dest: string;
  setDest: (id: string) => void;
  buffer: 1 | 2;
  setBuffer: (b: 1 | 2) => void;
  alertMode: AlarmAlertMode;
  onAlertModeChange: (m: AlarmAlertMode) => void;
  recentRides: SavedRide[];
  routes: Plan[];
  selectedRouteIdx: number;
  onSelectRoute: (idx: number) => void;
  snap: TripSnapshot;
  locating: boolean;
  detectMsg: string | null;
  walkCountdown: number | null;
  onAutoDetect: () => void;
  onSwap: () => void;
  onStartTrip: () => void;
  onCancelTrip: () => void;
  onDismissAlarm: () => void;
  onSnoozeAlarm: () => void;
  onAdvanceInterchange: () => void;
  onRecalculateRecovery: () => void;
  onDismissRecovery: () => void;
  onEndWalkCountdown: () => void;
  onTestAlarm: () => void;
  onDepartNow: () => void;
  onAdvanceStation: () => void;
  onStepBackStation: () => void;
  onToggleDelay: () => void;
}) {
  const t = props.t;
  const snap = props.snap;
  const stations = props.stations;
  const currentPlan = props.routes[props.selectedRouteIdx] ?? props.routes[0];

  if (snap.state === 'idle') {
    return (
      <View>
        <Text style={[styles.sub, { color: t.textDim }]}>
          Boarded the metro? Select your journey details. The alarm fires {props.buffer} stop(s)
          before your destination using GPS distance, station arrivals, and underground dead-reckoning.
        </Text>

        {props.recentRides.length > 0 ? (
          <View style={styles.recentContainer}>
            <Text style={[styles.recentTitle, { color: t.textDim }]}>⚡ Frequent commutes</Text>
            <View style={styles.recentWrap}>
              {props.recentRides.map((r, i) => (
                <Pressable
                  key={i}
                  style={({ pressed }) => [
                    styles.recentChip,
                    { backgroundColor: t.surface, borderColor: t.border },
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => {
                    props.setEnteredAt(r.enteredAt);
                    props.setDest(r.dest);
                    props.setBuffer(r.buffer);
                  }}>
                  <Text style={[styles.recentChipText, { color: t.text }]} numberOfLines={1}>
                    {stations.get(r.enteredAt) ?? r.enteredAt} ➔ {stations.get(r.dest) ?? r.dest}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <TypeaheadPicker
          t={t}
          label="From (Boarded at)"
          value={props.enteredAt}
          options={stations}
          onChange={props.setEnteredAt}
        />
        <View style={styles.pickerActionRow}>
          <Button
            t={t}
            variant="ghost"
            noTopMargin
            label={props.locating ? '◎ Locating…' : '◎ Auto-detect station'}
            onPress={props.onAutoDetect}
            disabled={props.locating}
          />
          <Button t={t} variant="ghost" noTopMargin label="⇅ Swap Stations" onPress={props.onSwap} />
        </View>
        {props.detectMsg ? (
          <Text style={[styles.detectFeedback, { color: t.accent }]}>{props.detectMsg}</Text>
        ) : null}

        <TypeaheadPicker
          t={t}
          label="To (Destination station)"
          value={props.dest}
          options={stations}
          onChange={props.setDest}
        />

        {/* Route & Interchange Options (Top 2 routes) */}
        {props.routes.length > 0 && (
          <RouteOptionsSelector
            t={t}
            routes={props.routes}
            selectedIdx={props.selectedRouteIdx}
            onSelect={props.onSelectRoute}
          />
        )}

        <Text style={[styles.label, { color: t.textDim }]}>Alarm before destination</Text>
        <View style={styles.bufferRow}>
          {[1, 2].map(n => (
            <Pressable
              key={n}
              style={[
                styles.bufferChip,
                { backgroundColor: t.surface, borderColor: t.border },
                props.buffer === n && { backgroundColor: t.accent, borderColor: t.accent },
              ]}
              onPress={() => props.setBuffer(n as 1 | 2)}>
              <Text
                style={[
                  styles.bufferText,
                  { color: props.buffer === n ? t.onAccent : t.textDim },
                ]}>
                {n} stop{n > 1 ? 's' : ''} early
              </Text>
            </Pressable>
          ))}
        </View>

        <AlertModeSelector
          t={t}
          alertMode={props.alertMode}
          onChange={props.onAlertModeChange}
        />

        <Button
          t={t}
          label={
            currentPlan?.interchangeSummary
              ? `🚀 Start Trip (${currentPlan.interchangeSummary})`
              : 'Start trip'
          }
          onPress={props.onStartTrip}
        />
        <Button
          t={t}
          variant="ghost"
          noTopMargin
          label="🔊 Test alarm sound"
          onPress={props.onTestAlarm}
        />
        <Text style={[styles.note, { color: t.textDim }]}>
          Distance and verified station arrivals drive the alarm. 100% offline and battery optimized for underground tunnels.
        </Text>
      </View>
    );
  }

  const alarmed = snap.state === 'alarmed';
  const interchangeAlarmed = snap.state === 'interchange_alarm';
  const interchanging = snap.state === 'interchanging';
  const wrongTrip = snap.state === 'wrong_trip';
  const done = snap.state === 'done';
  const stops = snap.stopsRemaining != null ? Math.max(0, Math.ceil(snap.stopsRemaining)) : null;

  return (
    <View
      style={[
        styles.tripCard,
        { backgroundColor: t.surface, borderColor: t.border },
        alarmed && { borderColor: t.red, backgroundColor: t.dangerSoft },
        interchangeAlarmed && { borderColor: t.amber, backgroundColor: t.amberSoft },
        wrongTrip && { borderColor: t.red, backgroundColor: t.dangerSoft },
        done && { borderColor: t.green, backgroundColor: t.greenSoft },
      ]}>
      {/* Status Pill */}
      <View
        style={[
          styles.statusPill,
          { backgroundColor: t.accentSoft },
          alarmed && { backgroundColor: t.red },
          interchangeAlarmed && { backgroundColor: t.amber },
          interchanging && { backgroundColor: t.accent },
          wrongTrip && { backgroundColor: t.red },
          done && { backgroundColor: t.green },
          snap.isTrainDelayed && { backgroundColor: t.amber },
        ]}>
        <Text
          style={[
            styles.statusPillText,
            { color: t.accent },
            (alarmed || interchanging || wrongTrip || done) && { color: t.onAccent },
            (interchangeAlarmed || snap.isTrainDelayed) && { color: t.bg },
          ]}>
          {alarmed
            ? '● DESTINATION ALARM — WAKE UP & GET READY'
            : interchangeAlarmed
              ? '● CHANGE TRAIN — INTERCHANGE COMING UP'
              : interchanging
                ? '● AT INTERCHANGE — CHANGING PLATFORM'
                : wrongTrip
                  ? '⚠️ OFF-ROUTE / WRONG TRAIN DETECTED'
                  : done
                    ? '● ARRIVED AT DESTINATION'
                    : snap.isTrainDelayed
                      ? '⏸ TRAIN HALTED / SIGNAL DELAY — COUNTDOWN PAUSED'
                      : snap.isDwelling
                        ? '● AT STATION — WAITING FOR DEPARTURE'
                        : '● RIDING IN TRANSIT'}
        </Text>
      </View>

      {/* Recovery Card (Off-route / Wrong trip recovery mode) */}
      {wrongTrip && snap.recovery ? (
        <View style={[styles.recoveryBox, { backgroundColor: t.surface, borderColor: t.red }]}>
          <Text style={[styles.recoveryTitle, { color: t.red }]}>⚠️ Recovery Mode</Text>
          <Text style={[styles.recoveryMessage, { color: t.text }]}>
            {snap.recovery.message}
          </Text>
          {snap.recovery.recalculatedPlan ? (
            <View style={styles.recoveryDetails}>
              <Text style={[styles.recoveryPlanText, { color: t.accent }]}>
                New route to {snap.recovery.destinationName}: {snap.recovery.recalculatedPlan.stationCount} stops, ~
                {fmtMin(snap.recovery.recalculatedPlan.timeS)}
              </Text>
              <Button
                t={t}
                variant="primary"
                noTopMargin
                label="🔄 Recalculate Route from Here"
                onPress={props.onRecalculateRecovery}
              />
            </View>
          ) : null}
          <Button
            t={t}
            variant="ghost"
            noTopMargin
            label="Dismiss (I'm on the right track)"
            onPress={props.onDismissRecovery}
          />
        </View>
      ) : null}

      {/* Underground Tunnel Mode Guidance Card */}
      {snap.isUnderground && !done ? (
        <View
          style={[
            styles.undergroundCard,
            { backgroundColor: t.surface2, borderColor: snap.isTrainDelayed ? t.amber : t.accent },
          ]}>
          <View style={styles.undergroundHeader}>
            <Text
              style={[
                styles.undergroundTitle,
                { color: snap.isTrainDelayed ? t.amber : t.accent },
              ]}>
              🚇 Underground Tunnel Mode
            </Text>
            <View
              style={[
                styles.undergroundPill,
                { backgroundColor: snap.isTrainDelayed ? t.amberSoft : t.accentSoft },
              ]}>
              <Text
                style={[
                  styles.undergroundPillText,
                  { color: snap.isTrainDelayed ? t.amber : t.accent },
                ]}>
                {snap.isTrainDelayed ? '⏸ Signal Delay / Stopped' : 'Motion & Dead Reckoning'}
              </Text>
            </View>
          </View>
          <Text style={[styles.undergroundDesc, { color: t.textDim }]}>
            {snap.isTrainDelayed
              ? '⚠️ Train is halted or delayed in the tunnel. Timetable countdown is PAUSED so the alarm will not fire prematurely.'
              : snap.isDwelling
                ? '🚉 Dwelling at station platform. Waiting for departure.'
                : '▶ Train in transit between stations. Tracking via official timetable runtimes & motion sensors.'}
          </Text>
          <View style={styles.undergroundActionRow}>
            <Pressable
              onPress={props.onToggleDelay}
              style={({ pressed }) => [
                styles.undergroundBtn,
                {
                  backgroundColor: snap.isTrainDelayed ? t.green : t.amber,
                },
                pressed && styles.btnPressed,
              ]}>
              <Text style={[styles.undergroundBtnText, { color: t.onAccent }]}>
                {snap.isTrainDelayed ? '▶ Train Moving' : '⏸ Train Stopped / Delay'}
              </Text>
            </Pressable>
            <Pressable
              onPress={props.onDepartNow}
              style={({ pressed }) => [
                styles.undergroundBtn,
                { backgroundColor: t.accent },
                pressed && styles.btnPressed,
              ]}>
              <Text style={[styles.undergroundBtnText, { color: t.onAccent }]}>🚇 Departed</Text>
            </Pressable>
          </View>
          <View style={[styles.undergroundActionRow, { marginTop: 6 }]}>
            <Pressable
              onPress={props.onStepBackStation}
              style={({ pressed }) => [
                styles.undergroundBtn,
                { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 },
                pressed && styles.btnPressed,
              ]}>
              <Text style={[styles.undergroundBtnText, { color: t.textDim }]}>⏮ Prev Stop</Text>
            </Pressable>
            <Pressable
              onPress={props.onAdvanceStation}
              style={({ pressed }) => [
                styles.undergroundBtn,
                { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 },
                pressed && styles.btnPressed,
              ]}>
              <Text style={[styles.undergroundBtnText, { color: t.text }]}>⏭ Next Stop</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Main Big Stop Counter */}
      <Text style={[styles.tripBig, { color: t.text }]}>
        {done ? '✓' : stops != null ? stops : '…'}
        {!done ? (
          <Text style={[styles.tripBigUnit, { color: t.textDim }]}>
            {' '}
            {stops === 1 ? 'stop' : 'stops'} left
          </Text>
        ) : null}
      </Text>

      {/* Distance as Final Metric Badge */}
      {snap.distM != null && !done ? (
        <View style={[styles.distanceBadge, { backgroundColor: t.surface2, borderColor: t.border }]}>
          <Text style={[styles.distanceBadgeText, { color: t.accent }]}>
            📍 {(snap.distM / 1000).toFixed(1)} km to destination (Distance Metric)
          </Text>
        </View>
      ) : null}

      {/* Dwell notification: ETA is held while stopped */}
      {snap.isDwelling && !done && (
        <Text style={[styles.dwellNotice, { color: t.amber }]}>
          ℹ️ Stopped at station platform. Will auto-resume on departure or within 38 seconds.
        </Text>
      )}

      {/* Interchange guidance card */}
      {snap.interchange ? (
        <View
          style={[
            styles.interchangeCard,
            { backgroundColor: t.surface2, borderColor: interchangeAlarmed ? t.amber : t.border },
          ]}>
          <Text style={[styles.interchangeTitle, { color: interchangeAlarmed ? t.amber : t.accent }]}>
            {interchangeAlarmed
              ? '⚠️ Transfer Ahead'
              : interchanging
                ? '🔄 Change Line Now'
                : 'ℹ️ Upcoming Transfer'}
          </Text>

          {interchanging ? (
            <View style={styles.interchangeAutoBox}>
              <Text style={[styles.interchangeAutoNotice, { color: t.textDim }]}>
                ✨ Next train will be auto-detected when in motion.
              </Text>
              <Button
                t={t}
                noTopMargin
                variant="ghost"
                label="Manual: Boarded next train ✓"
                onPress={props.onAdvanceInterchange}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Ride Stats Grid */}
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
              {(snap.distM / 1000).toFixed(1)} km
            </Text>
          </View>
        ) : null}
        {snap.etaS != null ? (
          <View style={styles.tripStat}>
            <Text style={[styles.tripStatLabel, { color: t.textFaint }]}>estimated time</Text>
            <Text style={[styles.tripStatValue, { color: t.text }]}>
              {fmtMin(snap.etaS)}
            </Text>
          </View>
        ) : null}
        <View style={styles.tripStat}>
          <Text style={[styles.tripStatLabel, { color: t.textFaint }]}>battery saver</Text>
          <Text style={[styles.tripStatValue, { color: t.green }]}>
            {snap.batteryMode === 'economy' ? '⚡ Economy (8s)' : '⚡ Active (2s)'}
          </Text>
        </View>
      </View>

      {/* Live Alert Mode Toggle */}
      {!done ? (
        <View style={styles.tripAlertToggleWrap}>
          <Text style={[styles.tripAlertToggleLabel, { color: t.textDim }]}>Alert Mode:</Text>
          <View style={styles.tripAlertToggleChips}>
            {(['sound', 'vibration', 'silent'] as AlarmAlertMode[]).map(m => {
              const active = props.alertMode === m;
              const labels = { sound: '🔊 Sound', vibration: '📳 Vibrate', silent: '🔕 Silent' };
              return (
                <Pressable
                  key={m}
                  style={[
                    styles.tripAlertChip,
                    { backgroundColor: t.surface2, borderColor: t.border },
                    active && { backgroundColor: t.accentSoft, borderColor: t.accent },
                  ]}
                  onPress={() => props.onAlertModeChange(m)}>
                  <Text style={[styles.tripAlertChipText, { color: active ? t.accent : t.textDim }]}>
                    {labels[m]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Walk-to-exit countdown */}
      {done && props.walkCountdown != null && props.walkCountdown > 0 ? (
        <View style={[styles.walkCard, { backgroundColor: t.surface2, borderColor: t.green }]}>
          <Text style={[styles.cardTitle, { color: t.text }]}>🚶 Walk to exit</Text>
          <Text style={[styles.tripBig, { color: t.accent }]}>{props.walkCountdown}s</Text>
          <Text style={[styles.tripHint, { color: t.textDim }]}>
            Gather your belongings and head to the exit gate.
          </Text>
          <Button
            t={t}
            variant="ghost"
            noTopMargin
            label="Dismiss countdown"
            onPress={props.onEndWalkCountdown}
          />
        </View>
      ) : null}

      {/* Alarm controls */}
      {alarmed || interchangeAlarmed ? (
        <View style={styles.alarmActionRow}>
          <Button t={t} variant="warning" noTopMargin label="Snooze 3m" onPress={props.onSnoozeAlarm} />
          <Button t={t} variant="muted" noTopMargin label="Silence / Dismiss" onPress={props.onDismissAlarm} />
        </View>
      ) : null}
      <Button t={t} variant="ghost" noTopMargin label="End trip" onPress={props.onCancelTrip} />
    </View>
  );
}

/* ── Main App Component ────────────────────────────────────────────── */

function App(): React.JSX.Element {
  const stations = useMemo(() => collectStations(delhiNetwork), []);
  const options = useMemo(() => Array.from(stations.keys()), [stations]);

  // Persistent Trip Controller at App level
  const [mode, setMode] = useState<'splash' | 'trip' | 'planner'>('splash');
  const [isDark, setIsDark] = useState(true);
  const t = isDark ? DARK : LIGHT;

  const [enteredAt, setEnteredAt] = useState('dwarka-sector-21');
  const [dest, setDest] = useState('noida-electronic-city');
  const [buffer, setBuffer] = useState<1 | 2>(1);
  const [alertMode, setAlertMode] = useState<AlarmAlertMode>('sound');
  const [locating, setLocating] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [recentRides, setRecentRides] = useState<SavedRide[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [alarmRinging, setAlarmRinging] = useState(false);
  const [walkCountdown, setWalkCountdown] = useState<number | null>(null);

  const [snap, setSnap] = useState<TripSnapshot>({
    state: 'idle',
    lastStation: null,
    stopsRemaining: null,
    distM: null,
    etaS: null,
    interchange: null,
    recovery: null,
    isDwelling: false,
    isTrainDelayed: false,
    isUnderground: false,
    batteryMode: 'balanced',
  });

  const trip = useRef<TripController | null>(null);

  // Initialize TripController once at App level and persist across navigation
  useEffect(() => {
    const controller = new TripController(delhiNetwork, s => setSnap({ ...s }));
    trip.current = controller;

    const sub = DeviceEventEmitter.addListener('MetroTripLocation', fix => {
      controller.onFix(fix);
    });

    const motionSub = DeviceEventEmitter.addListener('MetroMotionState', ({ moving }) => {
      controller.setMotion(moving);
    });

    const dismissSub = DeviceEventEmitter.addListener('MetroAlarmDismissed', () => {
      controller.dismiss();
      setAlarmRinging(false);
    });

    (async () => {
      try {
        const lastTrip = await MetroAlarm.getString('metro_last_trip');
        if (lastTrip) {
          const parsed = JSON.parse(lastTrip);
          if (parsed.enteredAt) setEnteredAt(parsed.enteredAt);
          if (parsed.dest) setDest(parsed.dest);
          if (parsed.buffer) setBuffer(parsed.buffer);
        }
        const recents = await MetroAlarm.getString('metro_recent_rides');
        if (recents) {
          const list = JSON.parse(recents);
          if (Array.isArray(list)) setRecentRides(list);
        }
        const savedMode = await MetroAlarm.getString('metro_alarm_mode');
        if (savedMode === 'sound' || savedMode === 'vibration' || savedMode === 'silent') {
          setAlertMode(savedMode as AlarmAlertMode);
          controller.setAlertMode(savedMode as AlarmAlertMode);
        }
      } catch {
        // Ignored
      }
    })();

    return () => {
      sub.remove();
      motionSub.remove();
      dismissSub.remove();
      controller.cancel();
    };
  }, []);

  // Walk countdown
  useEffect(() => {
    if (snap.state !== 'done') {
      setWalkCountdown(null);
      return;
    }
    setWalkCountdown(90);
    const tTimer = setInterval(() => {
      setWalkCountdown(c => (c != null && c > 0 ? c - 1 : null));
    }, 1000);
    (tTimer as any).unref?.();
    return () => clearInterval(tTimer);
  }, [snap.state]);

  const autoDetectOrigin = async () => {
    setLocating(true);
    setDetectMsg(null);
    try {
      await MetroAlarm.requestLocationPermission();
      const loc = await MetroAlarm.getLastKnownLocation();
      if (loc) {
        const coords = collectStationsWithCoords(delhiNetwork);
        let closest = coords[0];
        let minDist = Infinity;
        for (const s of coords) {
          const d = hav(loc, s);
          if (d < minDist) {
            minDist = d;
            closest = s;
          }
        }
        if (closest) {
          setEnteredAt(closest.id);
          const distStr = minDist < 1000 ? `${Math.round(minDist)} m` : `${(minDist / 1000).toFixed(1)} km`;
          setDetectMsg(`📍 Nearest: ${closest.name} (${distStr} away)`);
        }
      } else {
        setDetectMsg('⚠️ GPS fix unavailable. Pick your station manually.');
      }
    } catch {
      setDetectMsg('⚠️ Location access failed. Pick your station manually.');
    } finally {
      setLocating(false);
    }
  };

  const swapStations = () => {
    const temp = enteredAt;
    setEnteredAt(dest);
    setDest(temp);
    setSelectedRouteIdx(0);
  };

  const updateAlertMode = (newMode: AlarmAlertMode) => {
    setAlertMode(newMode);
    MetroAlarm.saveString('metro_alarm_mode', newMode).catch(() => {});
    MetroAlarm.setAlarmMode?.(newMode).catch(() => {});
    trip.current?.setAlertMode(newMode);
  };

  const startTripWithPlan = async (
    originId: string,
    destId: string,
    customPlan?: Plan,
    buf: 1 | 2 = 1,
  ) => {
    await MetroAlarm.requestNotificationPermission();
    await MetroAlarm.requestLocationPermission();

    const updated = [
      { enteredAt: originId, dest: destId, buffer: buf },
      ...recentRides.filter(r => !(r.enteredAt === originId && r.dest === destId)),
    ].slice(0, 4);
    setRecentRides(updated);
    MetroAlarm.saveString('metro_last_trip', JSON.stringify({ enteredAt: originId, dest: destId, buffer: buf })).catch(() => {});
    MetroAlarm.saveString('metro_recent_rides', JSON.stringify(updated)).catch(() => {});

    if (trip.current) {
      trip.current.arm({
        enteredAtId: originId,
        destId: destId,
        bufferStops: buf,
        plan: customPlan,
        alertMode: alertMode,
      });
      await MetroAlarm.startLocationUpdates();
      setMode('trip');
    }
  };

  const dismissAlarm = async () => {
    trip.current?.dismiss();
    await MetroAlarm.stopAlarm();
    await MetroAlarm.cancelScheduledAlarm();
    setAlarmRinging(false);
  };

  const cancelTrip = () => {
    trip.current?.cancel();
    MetroAlarm.stopLocationUpdates().catch(() => {});
  };

  const toggleTestAlarm = async () => {
    const isRinging = await MetroAlarm.isRinging();
    if (isRinging || alarmRinging) {
      await MetroAlarm.stopAlarm();
      setAlarmRinging(false);
    } else {
      await MetroAlarm.requestNotificationPermission();
      await MetroAlarm.startAlarm(alertMode);
      setAlarmRinging(true);
    }
  };

  // Planner routes with alternate interchanges
  const plannerRoutes = useMemo(() => {
    if (enteredAt === dest || !enteredAt || !dest) return [];
    return planAlternates(delhiNetwork, enteredAt, dest, 4);
  }, [enteredAt, dest]);

  const isTripActive = snap.state !== 'idle' && snap.state !== 'done';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
      {/* Top Navigation Bar */}
      <View style={[styles.topBar, { borderBottomColor: t.border }]}>
        <Pressable
          onPress={() => setMode('splash')}
          style={({ pressed }) => [styles.logoButton, pressed && styles.btnPressed]}>
          <Image source={require('./assets/icon.png')} style={styles.topLogoImg} resizeMode="contain" />
          <View>
            <Text style={[styles.appTitle, { color: t.text }]}>Metro Alarm</Text>
            <Text style={[styles.topSubtitle, { color: t.textDim }]}>Delhi Metro Geofenced</Text>
          </View>
        </Pressable>
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

      {/* Segmented Tab Navigation */}
      <View style={[styles.tabs, { backgroundColor: t.surface2, borderColor: t.border }]}>
        <Pressable
          style={({ pressed }) => [
            styles.tab,
            mode === 'splash' && [styles.tabActive, { backgroundColor: t.surface }],
            pressed && styles.tabPressed,
          ]}
          onPress={() => setMode('splash')}>
          <Text
            style={[
              styles.tabText,
              { color: t.textDim },
              mode === 'splash' && [{ color: t.accent }, styles.tabTextActive],
            ]}>
            🏠 Start
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.tab,
            mode === 'trip' && [styles.tabActive, { backgroundColor: t.surface }],
            pressed && styles.tabPressed,
          ]}
          onPress={() => setMode('trip')}>
          <Text
            style={[
              styles.tabText,
              { color: t.textDim },
              mode === 'trip' && [{ color: t.accent }, styles.tabTextActive],
            ]}>
            🔔 Trip alarm {isTripActive ? '●' : ''}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.tab,
            mode === 'planner' && [styles.tabActive, { backgroundColor: t.surface }],
            pressed && styles.tabPressed,
          ]}
          onPress={() => setMode('planner')}>
          <Text
            style={[
              styles.tabText,
              { color: t.textDim },
              mode === 'planner' && [{ color: t.accent }, styles.tabTextActive],
            ]}>
            🗺 Planner
          </Text>
        </Pressable>
      </View>

      {/* Active Trip Banner if viewing planner while a ride is active */}
      {mode === 'planner' && isTripActive ? (
        <ActiveTripBanner t={t} snap={snap} onPress={() => setMode('trip')} />
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        {mode === 'splash' ? (
          <SplashInputScreen
            t={t}
            stations={stations}
            enteredAt={enteredAt}
            setEnteredAt={id => {
              setEnteredAt(id);
              setSelectedRouteIdx(0);
            }}
            dest={dest}
            setDest={id => {
              setDest(id);
              setSelectedRouteIdx(0);
            }}
            buffer={buffer}
            setBuffer={setBuffer}
            alertMode={alertMode}
            setAlertMode={updateAlertMode}
            recentRides={recentRides}
            routes={plannerRoutes}
            selectedRouteIdx={selectedRouteIdx}
            onSelectRoute={setSelectedRouteIdx}
            locating={locating}
            detectMsg={detectMsg}
            onAutoDetect={autoDetectOrigin}
            onSwap={swapStations}
            onStartTrip={() =>
              startTripWithPlan(
                enteredAt,
                dest,
                plannerRoutes[selectedRouteIdx] ?? plannerRoutes[0],
                buffer,
              )
            }
            onOpenPlanner={() => setMode('planner')}
            onTestAlarm={toggleTestAlarm}
          />
        ) : mode === 'trip' ? (
          <TripScreen
            t={t}
            stations={stations}
            enteredAt={enteredAt}
            setEnteredAt={id => {
              setEnteredAt(id);
              setSelectedRouteIdx(0);
            }}
            dest={dest}
            setDest={id => {
              setDest(id);
              setSelectedRouteIdx(0);
            }}
            buffer={buffer}
            setBuffer={setBuffer}
            alertMode={alertMode}
            onAlertModeChange={updateAlertMode}
            recentRides={recentRides}
            routes={plannerRoutes}
            selectedRouteIdx={selectedRouteIdx}
            onSelectRoute={setSelectedRouteIdx}
            snap={snap}
            locating={locating}
            detectMsg={detectMsg}
            walkCountdown={walkCountdown}
            onAutoDetect={autoDetectOrigin}
            onSwap={swapStations}
            onStartTrip={() =>
              startTripWithPlan(
                enteredAt,
                dest,
                plannerRoutes[selectedRouteIdx] ?? plannerRoutes[0],
                buffer,
              )
            }
            onCancelTrip={cancelTrip}
            onDismissAlarm={dismissAlarm}
            onSnoozeAlarm={() => trip.current?.snooze(3)}
            onAdvanceInterchange={() => trip.current?.advanceInterchange()}
            onRecalculateRecovery={() => trip.current?.recalculate()}
            onDismissRecovery={() => trip.current?.dismissRecovery()}
            onEndWalkCountdown={() => setWalkCountdown(null)}
            onTestAlarm={toggleTestAlarm}
            onDepartNow={() => trip.current?.departNow()}
            onAdvanceStation={() => trip.current?.advanceStation()}
            onStepBackStation={() => trip.current?.stepBackStation()}
            onToggleDelay={() => trip.current?.setTrainDelayed(!snap.isTrainDelayed)}
          />
        ) : (
          <>
            <View style={styles.plannerHeaderRow}>
              <Text style={[styles.header, { color: t.text }]}>Delhi Route Planner</Text>
              <Text style={[styles.sub, { color: t.textDim }]}>
                {options.length} stations · Alternate interchanges · 100% offline
              </Text>
            </View>

            {/* Quick Popular Hub Chips for easy 1-tap test & switch */}
            <View style={styles.hubsWrap}>
              <Text style={[styles.hubsTitle, { color: t.textDim }]}>Quick Stations:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hubsScroll}>
                {[
                  { id: 'rajiv-chowk', name: 'Rajiv Chowk' },
                  { id: 'kashmere-gate', name: 'Kashmere Gate' },
                  { id: 'central-secretariat', name: 'Central Sectt' },
                  { id: 'hauz-khas', name: 'Hauz Khas' },
                  { id: 'mandi-house', name: 'Mandi House' },
                  { id: 'botanical-garden', name: 'Botanical Gdn' },
                  { id: 'dwarka-sector-21', name: 'Dwarka Sec 21' },
                  { id: 'noida-electronic-city', name: 'Noida Elec City' },
                ].map(hub => (
                  <Pressable
                    key={hub.id}
                    style={({ pressed }) => [
                      styles.hubChip,
                      { backgroundColor: t.surface2, borderColor: t.border },
                      pressed && styles.btnPressed,
                    ]}
                    onPress={() => {
                      if (!enteredAt) {
                        setEnteredAt(hub.id);
                      } else if (!dest || dest === hub.id) {
                        setDest(hub.id);
                      } else {
                        setDest(hub.id);
                      }
                    }}>
                    <Text style={[styles.hubChipText, { color: t.text }]}>{hub.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <TypeaheadPicker
              t={t}
              label="Starting Station"
              value={enteredAt}
              options={stations}
              onChange={setEnteredAt}
            />

            <View style={styles.plannerActionRow}>
              <Button t={t} variant="ghost" noTopMargin label="⇅ Swap Stations" onPress={swapStations} />
              <Button
                t={t}
                variant="ghost"
                noTopMargin
                label="✕ Clear Both"
                onPress={() => {
                  setEnteredAt('');
                  setDest('');
                }}
              />
            </View>

            <TypeaheadPicker
              t={t}
              label="Destination Station"
              value={dest}
              options={stations}
              onChange={setDest}
            />

            {enteredAt === dest || !enteredAt || !dest ? (
              <Text style={[styles.note, { color: t.textDim }]}>
                Select two different stations to calculate journey routes and interchange alternatives.
              </Text>
            ) : (
              <>
                <Text style={[styles.plannerResultsHeader, { color: t.text }]}>
                  Available Routes ({plannerRoutes.length})
                </Text>

                {plannerRoutes.map((routePlan, idx) => {
                  const title =
                    routePlan.label ??
                    (idx === 0 ? '⚡ Fastest Route' : `🔄 Alternate Route #${idx + 1}`);
                  return (
                    <RouteCard
                      key={`${routePlan.interchangeSummary ?? ''}-${idx}`}
                      t={t}
                      title={title}
                      plan={routePlan}
                      isPrimary={idx === 0}
                      onSetAlarm={() => startTripWithPlan(enteredAt, dest, routePlan, buffer)}
                    />
                  );
                })}

                <Button
                  t={t}
                  variant={alarmRinging ? 'muted' : 'ghost'}
                  label={alarmRinging ? 'Stop test alarm' : '🔊 Test Alarm Sound'}
                  onPress={toggleTestAlarm}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Styles (Aesthetic & Polish) ──────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1 } as ViewStyle,
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  } as ViewStyle,
  logoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,
  topLogoImg: {
    width: 34,
    height: 34,
    borderRadius: 8,
  } as ImageStyle,
  appTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  } as TextStyle,
  topSubtitle: {
    fontSize: 11,
    fontWeight: '500',
  } as TextStyle,
  themeToggle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  themeToggleIcon: { fontSize: 16, fontWeight: '700' } as TextStyle,
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  } as ViewStyle,
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  } as ViewStyle,
  tabActive: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  } as ViewStyle,
  tabPressed: { opacity: 0.8 } as ViewStyle,
  tabText: { fontSize: 13, fontWeight: '600' } as TextStyle,
  tabTextActive: { fontWeight: '800' } as TextStyle,
  content: { padding: 16, paddingBottom: 40 } as ViewStyle,
  header: { fontSize: 24, fontWeight: '800' } as TextStyle,
  sub: {
    fontSize: 13,
    marginBottom: 16,
    marginTop: 4,
    lineHeight: 19,
  } as TextStyle,
  pickerWrapper: {
    marginBottom: 8,
  } as ViewStyle,
  pickerLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 4,
  } as ViewStyle,
  clearLinkText: {
    fontSize: 12,
    fontWeight: '700',
  } as TextStyle,
  label: {
    fontSize: 11,
    marginTop: 8,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  } as TextStyle,
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.2,
    borderRadius: 12,
    paddingHorizontal: 12,
  } as ViewStyle,
  inputField: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '500',
  } as TextStyle,
  inputClearBtn: {
    padding: 6,
  } as ViewStyle,
  inputClearText: {
    fontSize: 14,
    fontWeight: '700',
  } as TextStyle,
  suggestBox: {
    borderWidth: 1.5,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  } as ViewStyle,
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  } as ViewStyle,
  suggestHeaderTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  } as TextStyle,
  suggestCloseText: {
    fontSize: 12,
    fontWeight: '800',
  } as TextStyle,
  suggestScroll: { maxHeight: 220 } as ViewStyle,
  suggestRow: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  } as ViewStyle,
  suggestText: { fontSize: 14, fontWeight: '500' } as TextStyle,
  suggestTextActive: { fontWeight: '700' } as TextStyle,
  suggestEmpty: { padding: 14, fontSize: 13 } as TextStyle,
  btn: {
    marginTop: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  btnGhost: { borderWidth: 1 } as ViewStyle,
  btnNoMargin: { marginTop: 0 } as ViewStyle,
  btnPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] } as ViewStyle,
  btnDisabled: { opacity: 0.45 } as ViewStyle,
  btnText: { fontSize: 14, fontWeight: '700' } as TextStyle,
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.2,
  } as ViewStyle,
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  } as ViewStyle,
  cardTitle: { fontSize: 16, fontWeight: '700' } as TextStyle,
  cardMeta: { alignItems: 'flex-end' } as ViewStyle,
  cardMetaBig: { fontSize: 19, fontWeight: '800' } as TextStyle,
  cardMetaDim: { fontSize: 12, marginTop: 2 } as TextStyle,
  timeline: { marginTop: 12, marginBottom: 12, gap: 4 } as ViewStyle,
  leg: {} as ViewStyle,
  legRail: { borderLeftWidth: 3.5, paddingLeft: 14, marginLeft: 4 } as ViewStyle,
  legStationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 3,
  } as ViewStyle,
  legDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
  } as ViewStyle,
  legDotEnd: { width: 8, height: 8, borderRadius: 4 } as ViewStyle,
  legStation: { fontSize: 14, fontWeight: '600', flexShrink: 1 } as TextStyle,
  legStops: { fontSize: 12, marginLeft: 22 } as TextStyle,
  transferRow: { paddingLeft: 22, paddingVertical: 6 } as ViewStyle,
  transferText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  } as TextStyle,
  note: { fontSize: 12, marginTop: 10, marginBottom: 10, lineHeight: 18 } as TextStyle,
  pickerActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 6,
  } as ViewStyle,
  bufferRow: { flexDirection: 'row', gap: 8, marginTop: 2 } as ViewStyle,
  bufferChip: {
    flex: 1,
    borderWidth: 1.2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  } as ViewStyle,
  bufferText: { fontSize: 12, fontWeight: '700' } as TextStyle,
  tripCard: {
    marginTop: 8,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'flex-start',
  } as ViewStyle,
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  } as ViewStyle,
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  } as TextStyle,
  tripBig: { fontSize: 52, fontWeight: '900', marginTop: 8 } as TextStyle,
  tripBigUnit: { fontSize: 18, fontWeight: '600' } as TextStyle,
  tripHint: { fontSize: 13, marginTop: 4, fontStyle: 'italic' } as TextStyle,
  distanceBadge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  } as ViewStyle,
  distanceBadgeText: { fontSize: 13, fontWeight: '700' } as TextStyle,
  dwellNotice: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    lineHeight: 18,
  } as TextStyle,
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
  tripStatValue: { fontSize: 15, fontWeight: '700', marginTop: 2 } as TextStyle,
  alarmActionRow: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'stretch',
    marginTop: 10,
  } as ViewStyle,
  recentContainer: {
    marginTop: 12,
    marginBottom: 8,
  } as ViewStyle,
  recentTitle: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  } as TextStyle,
  recentWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,
  recentChip: {
    borderWidth: 1.2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  } as ViewStyle,
  recentChipText: {
    fontSize: 12,
    fontWeight: '600',
  } as TextStyle,
  detectFeedback: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 4,
  } as TextStyle,
  interchangeCard: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginVertical: 12,
    alignSelf: 'stretch',
  } as ViewStyle,
  interchangeTitle: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  } as TextStyle,
  interchangeInstruction: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 6,
  } as TextStyle,
  platformBadge: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  } as TextStyle,
  interchangeAutoBox: {
    marginTop: 8,
    gap: 6,
  } as ViewStyle,
  interchangeAutoNotice: {
    fontSize: 12,
    fontStyle: 'italic',
  } as TextStyle,
  walkCard: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    alignSelf: 'stretch',
  } as ViewStyle,
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1.5,
  } as ViewStyle,
  activeBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  } as ViewStyle,
  activeBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
  } as TextStyle,
  activeBannerSub: {
    fontSize: 11,
    marginTop: 2,
  } as TextStyle,
  activeBannerAction: {
    fontSize: 13,
    fontWeight: '800',
  } as TextStyle,
  recoveryBox: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginVertical: 10,
    alignSelf: 'stretch',
  } as ViewStyle,
  recoveryTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  } as TextStyle,
  recoveryMessage: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  } as TextStyle,
  recoveryDetails: {
    gap: 6,
    marginBottom: 6,
  } as ViewStyle,
  recoveryPlanText: {
    fontSize: 13,
    fontWeight: '700',
  } as TextStyle,
  splashContainer: {
    paddingBottom: 24,
  } as ViewStyle,
  splashHero: {
    alignItems: 'center',
    marginBottom: 18,
  } as ViewStyle,
  metroIconRing: {
    width: 88,
    height: 88,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  } as ViewStyle,
  splashHeroImg: {
    width: 80,
    height: 80,
    borderRadius: 20,
  } as ImageStyle,
  splashTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.3,
  } as TextStyle,
  splashTagline: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
    lineHeight: 18,
  } as TextStyle,
  offlineBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
  } as ViewStyle,
  offlineBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  } as TextStyle,
  splashCard: {
    borderWidth: 1.2,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,
  splashCardHeading: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 8,
  } as TextStyle,
  splashFootActions: {
    gap: 8,
    marginTop: 10,
  } as ViewStyle,
  cardTitleWrap: {
    flex: 1,
    gap: 4,
  } as ViewStyle,
  interchangeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  } as ViewStyle,
  interchangeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  } as TextStyle,
  alertModeContainer: {
    marginVertical: 10,
  } as ViewStyle,
  alertModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  } as ViewStyle,
  alertModeChip: {
    flex: 1,
    borderWidth: 1.2,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  alertModeIcon: {
    fontSize: 18,
    marginBottom: 4,
  } as TextStyle,
  alertModeTitle: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  } as TextStyle,
  alertModeTitleActive: {
    fontWeight: '800',
  } as TextStyle,
  alertModeSub: {
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
  } as TextStyle,
  offlineExplainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  } as ViewStyle,
  offlineExplainerText: {
    fontSize: 12,
    lineHeight: 17,
  } as TextStyle,
  undergroundCard: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginVertical: 10,
    alignSelf: 'stretch',
  } as ViewStyle,
  undergroundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  } as ViewStyle,
  undergroundTitle: {
    fontSize: 14,
    fontWeight: '800',
  } as TextStyle,
  undergroundPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  } as ViewStyle,
  undergroundPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  } as TextStyle,
  undergroundDesc: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  } as TextStyle,
  undergroundActionRow: {
    flexDirection: 'row',
    gap: 8,
  } as ViewStyle,
  undergroundBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  undergroundBtnText: {
    fontSize: 12,
    fontWeight: '700',
  } as TextStyle,
  tripAlertToggleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    alignSelf: 'stretch',
  } as ViewStyle,
  tripAlertToggleLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  } as TextStyle,
  tripAlertToggleChips: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  } as ViewStyle,
  tripAlertChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  tripAlertChipText: {
    fontSize: 11,
    fontWeight: '700',
  } as TextStyle,
  plannerHeaderRow: {
    marginBottom: 6,
  } as ViewStyle,
  hubsWrap: {
    marginVertical: 8,
  } as ViewStyle,
  hubsTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  } as TextStyle,
  hubsScroll: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 4,
  } as ViewStyle,
  hubChip: {
    borderWidth: 1.2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  } as ViewStyle,
  hubChipText: {
    fontSize: 12,
    fontWeight: '600',
  } as TextStyle,
  plannerActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 4,
  } as ViewStyle,
  plannerResultsHeader: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 2,
  } as TextStyle,
  routeSelectorWrap: {
    marginVertical: 10,
    alignSelf: 'stretch',
  } as ViewStyle,
  routeCardsRow: {
    gap: 8,
    marginTop: 6,
  } as ViewStyle,
  routeOptionCard: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
  } as ViewStyle,
  routeOptionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  } as ViewStyle,
  routeOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
  } as TextStyle,
  routeBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  } as ViewStyle,
  routeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ffffff',
  } as TextStyle,
  routeOptionSummary: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  } as TextStyle,
  routeOptionMeta: {
    fontSize: 11,
  } as TextStyle,
});

export default App;

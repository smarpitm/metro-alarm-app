import { TripController, type Fix, type TripSnapshot } from '../src/trip/TripController';
import { delhiNetwork } from '../src/metro/delhiNetwork';
import { MetroAlarm } from '../src/native/MetroAlarm';

jest.mock('../src/native/MetroAlarm', () => ({
  MetroAlarm: {
    startAlarm: jest.fn().mockResolvedValue(true),
    stopAlarm: jest.fn().mockResolvedValue(true),
    requestNotificationPermission: jest.fn().mockResolvedValue(true),
    requestLocationPermission: jest.fn().mockResolvedValue(true),
    startLocationUpdates: jest.fn().mockResolvedValue(true),
    stopLocationUpdates: jest.fn().mockResolvedValue(true),
    isRinging: jest.fn().mockResolvedValue(false),
    scheduleAlarm: jest.fn().mockResolvedValue(true),
    cancelScheduledAlarm: jest.fn().mockResolvedValue(true),
    setTrackingMode: jest.fn().mockResolvedValue(true),
    getLastKnownLocation: jest.fn().mockResolvedValue({ lat: 28.55, lon: 77.05, accuracy: 10, ts: 1760000000000 }),
  },
}));

type Pin = { id: string; name: string; lat: number; lon: number; toNextS: number };

/** Linearly interpolate a fix sequence along the route at ~12 m/s. */
function replay(route: Pin[], stopAtIdx: number): Fix[] {
  const fixes: Fix[] = [];
  let ts = 1_760_000_000_000;
  const speedMs = 12;
  for (let i = 0; i < stopAtIdx && i + 1 < route.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    const dLat = b.lat - a.lat;
    const dLon = b.lon - a.lon;
    const distM =
      Math.hypot(dLat * 111_320, dLon * 111_320 * Math.cos((a.lat * Math.PI) / 180));
    const steps = Math.max(1, Math.ceil(distM / 25));
    for (let s = 1; s <= steps; s++) {
      fixes.push({
        lat: a.lat + (dLat * s) / steps,
        lon: a.lon + (dLon * s) / steps,
        accuracy: 5,
        speed: speedMs,
        ts: (ts += 500),
      });
    }
  }
  // jitter: none — perfect GPS for the happy path
  return fixes;
}

const lastSnap = (states: TripSnapshot[]) => states[states.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TripController (overview replay)', () => {
  it('plans a route across the branch split (Dwarka 21 → Vaishali)', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });
    expect(route.length).toBeGreaterThanOrEqual(40);
    expect(route[0].id).toBe('dwarka-sector-21');
    expect(route.at(-1)!.id).toBe('vaishali');
    // Yamuna Bank junction appears exactly once in the sequence
    expect(route.filter(p => p.id === 'yamuna-bank').length).toBe(1);
    expect(trip.currentState.state).toBe('riding');
  });

  it('fires the alarm when the ride comes within the buffer of the destination', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });
    const atDestMinus1 = route.length - 2;
    for (const fix of replay(route, atDestMinus1)) {
      trip.onFix(fix);
    }
    const snap = lastSnap(states);
    expect(snap.state).toBe('alarmed');
    expect(MetroAlarm.startAlarm).toHaveBeenCalled();
    // stops remaining counted the way the rider feels it
    expect(snap.stopsRemaining).toBeLessThanOrEqual(1);
  });

  it('does not fire early in the middle of the line', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });
    for (const fix of replay(route, Math.min(10, route.length - 2))) {
      trip.onFix(fix);
    }
    expect(lastSnap(states).state).toBe('riding');
    expect(MetroAlarm.startAlarm).not.toHaveBeenCalled();
  });

  it('fires 2 stops early when the rider chose a 2-stop buffer', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 2 });
    for (const fix of replay(route, route.length - 3)) {
      trip.onFix(fix);
    }
    expect(lastSnap(states).state).toBe('alarmed');
  });

  it('marks the trip done at the destination and silences the alarm', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });
    for (const fix of replay(route, route.length - 1)) {
      trip.onFix(fix);
      if (trip.currentState.state === 'alarmed') {
        trip.dismiss();
      }
    }
    // final push: a fix right at the destination
    const dest = route.at(-1)!;
    trip.onFix({ lat: dest.lat, lon: dest.lon, accuracy: 5, speed: 2, ts: 1_760_010_000_000 });
    expect(trip.currentState.state).toBe('done');
    expect(MetroAlarm.stopAlarm).toHaveBeenCalled();
  });

  it('ignores noisy fixes (accuracy worse than snap radius)', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });
    for (const fix of replay(route, Math.min(10, route.length - 2))) {
      trip.onFix(fix);
    }
    const before = lastSnap(states).lastStation;
    // a fix 'near the destination' but with 900 m reported accuracy
    const dest = route.at(-1)!;
    trip.onFix({
      lat: dest.lat,
      lon: dest.lon,
      accuracy: 900,
      speed: 5,
      ts: 1_760_020_000_000,
    });
    // snap radius unaffected lastStation still the same pinned station
    expect(lastSnap(states).lastStation).toBe(before);
  });

  it('schedules native alarm watchdog when armed and cancels when cancelled', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });
    expect(MetroAlarm.scheduleAlarm).toHaveBeenCalled();

    trip.cancel();
    expect(MetroAlarm.cancelScheduledAlarm).toHaveBeenCalled();
  });

  it('triggers underground fallback alarm via ETA countdown when GPS is lost', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });

    // Ride until 2 stops before destination
    const nearDestIdx = route.length - 3;
    const now = 1_760_000_000_000;
    const fixes = replay(route, nearDestIdx);
    for (const fix of fixes) {
      trip.onFix(fix);
    }
    expect(lastSnap(states).state).toBe('riding');

    // Simulate GPS signal completely dying in a tunnel; advance clock past the buffer stop travel time
    const timeToBufferStationS = route[nearDestIdx].toNextS + 10;
    trip.tick((fixes.at(-1)?.ts ?? now) + timeToBufferStationS * 1000);

    // Watchdog / ETA fallback triggers
    expect(lastSnap(states).state).toBe('alarmed');
    expect(MetroAlarm.startAlarm).toHaveBeenCalled();
  });

  it('snoozes the alarm and reschedules', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });
    for (const fix of replay(route, route.length - 2)) {
      trip.onFix(fix);
    }
    expect(lastSnap(states).state).toBe('alarmed');

    trip.snooze(3);
    expect(MetroAlarm.stopAlarm).toHaveBeenCalled();
    expect(trip.currentState.state).toBe('riding');
    // schedules next alarm 3 mins (180,000 ms) in future
    expect(MetroAlarm.scheduleAlarm).toHaveBeenCalled();

    trip.cancel();
  });

  it('handles multi-line interchange: alerts before transfer, shows platform, and includes transfer penalty in ETA', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    // Central Secretariat (Yellow Line) -> Noida Sector 18 (Blue Line) transfers at Rajiv Chowk
    const route = trip.arm({ enteredAtId: 'central-secretariat', destId: 'noida-sector-18', bufferStops: 1 });
    const mandiIdx = route.findIndex(p => p.id === 'mandi-house');
    expect(mandiIdx).toBeGreaterThan(0);

    // Initial snapshot should include transfer penalty in ETA (at least 300s)
    const initialSnap = lastSnap(states);
    expect(initialSnap.etaS).toBeGreaterThanOrEqual(delhiNetwork.transferPenaltyS);
    expect(initialSnap.interchange).not.toBeNull();
    expect(initialSnap.interchange?.stationId).toBe('mandi-house');
    expect(initialSnap.interchange?.platform).toBe('Platform 2');
    expect(initialSnap.interchange?.instruction).toContain('Change at Mandi House');

    // Replay fixes up to 1 stop before Mandi House (Janpath)
    for (const fix of replay(route, mandiIdx - 1)) {
      trip.onFix(fix);
    }
    const preInterchangeSnap = lastSnap(states);
    expect(preInterchangeSnap.state).toBe('interchange_alarm');
    expect(MetroAlarm.startAlarm).toHaveBeenCalled();

    // Replay fix at Mandi House (transfer station arrival)
    const mandiPin = route[mandiIdx];
    trip.onFix({ lat: mandiPin.lat, lon: mandiPin.lon, accuracy: 5, speed: 1, ts: 1_760_005_000_000 });
    expect(trip.currentState.state).toBe('interchanging');

    // Advance to next leg
    trip.advanceInterchange();
    expect(trip.currentState.state).toBe('riding');

    // Replay fixes to 1 stop before destination Noida Sector 18
    for (const fix of replay(route, route.length - 2)) {
      trip.onFix(fix);
    }
    const destAlarmSnap = lastSnap(states);
    expect(destAlarmSnap.state).toBe('alarmed');

    // Replay fix at final destination
    const destPin = route.at(-1)!;
    trip.onFix({ lat: destPin.lat, lon: destPin.lon, accuracy: 5, speed: 1, ts: 1_760_010_000_000 });
    expect(trip.currentState.state).toBe('done');

    trip.cancel();
  });

  it('pauses ETA countdown and does not trigger premature alarm while dwelling at station or interchange', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });

    const initialEta = trip.currentState.etaS!;
    expect(trip.currentState.isDwelling).toBe(true);

    // Rider spends 5 minutes standing still at Dwarka Sector 21 (speed 0.2 m/s, within station radius)
    for (let sec = 1; sec <= 300; sec += 10) {
      trip.onFix({
        lat: route[0].lat + 0.0001,
        lon: route[0].lon + 0.0001,
        accuracy: 10,
        speed: 0.2,
        ts: 1_760_000_000_000 + sec * 1000,
      });
      trip.tick(1_760_000_000_000 + sec * 1000);
    }

    // ETA must NOT have decremented while stationary at the station!
    expect(trip.currentState.etaS).toBe(initialEta);
    expect(trip.currentState.state).toBe('riding');
    expect(MetroAlarm.startAlarm).not.toHaveBeenCalled();

    trip.cancel();
  });

  it('automatically detects boarded next train at interchange when moving onto next leg', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    // Central Secretariat -> Noida Sector 18 (interchange at Mandi House)
    const route = trip.arm({ enteredAtId: 'central-secretariat', destId: 'noida-sector-18', bufferStops: 1 });
    const mandiIdx = route.findIndex(p => p.id === 'mandi-house');

    // Reach Mandi House interchange
    for (const fix of replay(route, mandiIdx)) {
      trip.onFix(fix);
    }
    const mandiPin = route[mandiIdx];
    trip.onFix({ lat: mandiPin.lat, lon: mandiPin.lon, accuracy: 5, speed: 0.5, ts: 1_760_002_000_000 });
    expect(trip.currentState.state).toBe('interchanging');

    // Rider walks to next platform and boards next train towards Supreme Court (next station on Blue Line)
    const nextLegPin = route[mandiIdx + 1];
    // Fix near Supreme Court with motion speed
    trip.onFix({
      lat: nextLegPin.lat,
      lon: nextLegPin.lon,
      accuracy: 10,
      speed: 8.0,
      ts: 1_760_002_100_000,
    });

    // System automatically transitions out of interchanging back to riding!
    expect(trip.currentState.state).toBe('riding');
    expect(trip.currentState.lastStation).toBe(nextLegPin.name);

    trip.cancel();
  });

  it('triggers recovery mode when rider boards the wrong train / off-route and supports recalculation', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    // Planned trip: Rajiv Chowk -> Dwarka Sector 21 (Blue Line heading west)
    trip.arm({ enteredAtId: 'rajiv-chowk', destId: 'dwarka-sector-21', bufferStops: 1 });

    // But user accidentally boarded the Yellow Line train heading north towards Kashmere Gate!
    // Kashmere Gate coords: lat ~28.6675, lon ~77.2285
    const kashmereFix: Fix = {
      lat: 28.6675,
      lon: 77.2285,
      accuracy: 10,
      speed: 10,
      ts: 1_760_001_000_000,
    };

    trip.onFix(kashmereFix);
    trip.onFix({ ...kashmereFix, ts: 1_760_001_005_000 });

    expect(trip.currentState.state).toBe('wrong_trip');
    expect(trip.currentState.recovery).not.toBeNull();
    expect(trip.currentState.recovery?.currentStationId).toBe('kashmere-gate');
    expect(trip.currentState.recovery?.recalculatedPlan).not.toBeNull();

    // User taps 1-click recalculate
    trip.recalculate();
    expect(trip.currentState.state).toBe('riding');
    expect(trip.currentState.lastStation).toBe('Kashmere Gate');

    trip.cancel();
  });

  it('adjusts battery tracking mode between economy and approaching based on distance and stops', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    // Long trip: Dwarka Sector 21 -> Noida Electronic City (~50 km, > 40 stops)
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'noida-electronic-city', bufferStops: 1 });

    // Cruising far away
    trip.onFix({ lat: route[1].lat, lon: route[1].lon, accuracy: 10, speed: 12, ts: 1_760_000_050_000 });
    expect(MetroAlarm.setTrackingMode).toHaveBeenCalledWith('economy');

    // Nearing destination (1 stop away)
    const nearDest = route[route.length - 2];
    trip.onFix({ lat: nearDest.lat, lon: nearDest.lon, accuracy: 10, speed: 5, ts: 1_760_005_000_000 });
    expect(MetroAlarm.setTrackingMode).toHaveBeenCalledWith('approaching');

    trip.cancel();
  });
});

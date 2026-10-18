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
});

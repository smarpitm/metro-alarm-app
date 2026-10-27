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
function replay(route: Pin[], stopAtIdx: number, startAtIdx = 0): Fix[] {
  const fixes: Fix[] = [];
  let ts = 1_760_000_000_000;
  const speedMs = 12;
  for (let i = startAtIdx; i < stopAtIdx && i + 1 < route.length; i++) {
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

  it('never re-triggers the alarm once dismissed by the user', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({ enteredAtId: 'dwarka-sector-21', destId: 'vaishali', bufferStops: 1 });

    // Trigger destination alarm
    const atDestMinus1 = route.length - 2;
    for (const fix of replay(route, atDestMinus1)) {
      trip.onFix(fix);
    }
    expect(trip.currentState.state).toBe('alarmed');
    expect(MetroAlarm.startAlarm).toHaveBeenCalledTimes(1);

    // User dismisses the alarm
    trip.dismiss();
    expect(trip.currentState.state).toBe('riding');
    expect(MetroAlarm.cancelScheduledAlarm).toHaveBeenCalled();

    // Rider receives subsequent fixes at the same or next station
    const destPin = route[route.length - 1];
    trip.onFix({ lat: destPin.lat, lon: destPin.lon, accuracy: 5, speed: 10, ts: 1_760_010_000_000 });
    trip.tick(1_760_010_005_000);

    // startAlarm must NOT have been called again!
    expect(MetroAlarm.startAlarm).toHaveBeenCalledTimes(1);
    expect(trip.currentState.state).not.toBe('alarmed');

    trip.cancel();
  });

  it('arms with a custom alternate interchange plan', () => {
    const { planAlternates } = require('../src/metro/planner');
    const plans = planAlternates(delhiNetwork, 'noida-sector-18', 'hauz-khas');
    expect(plans.length).toBeGreaterThanOrEqual(1);

    const trip = new TripController(delhiNetwork, () => {});
    const selectedPlan = plans[0];
    const route = trip.arm({
      enteredAtId: 'noida-sector-18',
      destId: 'hauz-khas',
      bufferStops: 1,
      plan: selectedPlan,
    });

    expect(route[0].id).toBe('noida-sector-18');
    expect(route.at(-1)!.id).toBe('hauz-khas');
    trip.cancel();
  });

  it('respects silent alert mode when firing alarms', () => {
    const trip = new TripController(delhiNetwork, () => {});
    const route = trip.arm({
      enteredAtId: 'dwarka-sector-21',
      destId: 'vaishali',
      bufferStops: 1,
      alertMode: 'silent',
    });

    const atDestMinus1 = route.length - 2;
    for (const fix of replay(route, atDestMinus1)) {
      trip.onFix(fix);
    }

    expect(trip.currentState.state).toBe('alarmed');
    expect(MetroAlarm.startAlarm).toHaveBeenCalledWith('silent');
    trip.cancel();
  });

  it('activates underground dead-reckoning when GPS fixes are lost and auto-departs platform', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const startTime = 1_760_000_000_000;
    const route = trip.arm({
      enteredAtId: 'rajiv-chowk',
      destId: 'chandni-chowk',
      bufferStops: 1,
      now: startTime,
    });
    // Initial state: dwelling at origin platform
    expect(trip.currentState.isDwelling).toBe(true);

    // 45 seconds later, underground with zero GPS fixes: train has departed platform
    trip.tick(startTime + 45_000);
    expect(trip.currentState.isDwelling).toBe(false);
    expect(trip.currentState.isUnderground).toBe(true);
    expect(trip.currentState.gpsStatus).toBe('underground');

    // Run time from first station to second station elapses
    trip.tick(startTime + 45_000 + (route[0].toNextS + 5) * 1000);
    // Cursor advances to next underground station
    expect(trip.currentState.lastStation).toBe(route[1].name);

    trip.cancel();
  });

  it('dismissing destination alarm cancels watchdog and prevents re-triggering', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({
      enteredAtId: 'dwarka-sector-21',
      destId: 'vaishali',
      bufferStops: 1,
    });

    const atDestMinus1 = route.length - 2;
    for (const fix of replay(route, atDestMinus1)) {
      trip.onFix(fix);
    }
    expect(trip.currentState.state).toBe('alarmed');

    // Dismiss alarm
    trip.dismiss();
    expect(trip.currentState.state).toBe('riding');
    expect(MetroAlarm.stopAlarm).toHaveBeenCalled();
    expect(MetroAlarm.cancelScheduledAlarm).toHaveBeenCalled();

    // Subsequent ticks or watchdog should not reschedule a 10s alarm
    (MetroAlarm.scheduleAlarm as jest.Mock).mockClear();
    trip.tick(1_760_000_100_000);
    expect(MetroAlarm.scheduleAlarm).not.toHaveBeenCalled();
    expect(trip.currentState.state).toBe('riding');

    trip.cancel();
  });

  it('pauses dead-reckoning progression when train is delayed or stationary in underground tunnel', () => {
    const trip = new TripController(delhiNetwork, () => {});
    const startTime = 1_760_000_000_000;
    const route = trip.arm({
      enteredAtId: 'rajiv-chowk',
      destId: 'chandni-chowk',
      bufferStops: 1,
      now: startTime,
    });

    // Depart platform
    trip.tick(startTime + 45_000);
    expect(trip.currentState.isDwelling).toBe(false);

    // Train gets stuck in tunnel: set delayed
    trip.setTrainDelayed(true);
    expect(trip.currentState.isTrainDelayed).toBe(true);

    const initialEta = trip.currentState.etaS;
    const initialLastStation = trip.currentState.lastStation;

    // Time passes while train is delayed
    trip.tick(startTime + 45_000 + 300_000); // 5 minutes pass
    expect(trip.currentState.lastStation).toBe(initialLastStation);
    expect(trip.currentState.etaS).toBe(initialEta);

    // Train resumes moving
    trip.setTrainDelayed(false);
    expect(trip.currentState.isTrainDelayed).toBe(false);

    trip.cancel();
  });

  it('supports manual station advance and step back for rider correction in tunnels', () => {
    const trip = new TripController(delhiNetwork, () => {});
    const route = trip.arm({
      enteredAtId: 'rajiv-chowk',
      destId: 'samaypur-badli',
      bufferStops: 1,
    });

    expect(trip.currentState.lastStation).toBe(route[0].name);

    // Rider taps Next Station
    trip.advanceStation();
    expect(trip.currentState.lastStation).toBe(route[1].name);
    expect(trip.currentState.stopsRemaining).toBe(route.length - 2);

    // Rider taps Prev Station
    trip.stepBackStation();
    expect(trip.currentState.lastStation).toBe(route[0].name);
    expect(trip.currentState.stopsRemaining).toBe(route.length - 1);

    // Edge case: stepping back at origin station should not underflow or crash
    trip.stepBackStation();
    expect(trip.currentState.lastStation).toBe(route[0].name);
    expect(trip.currentState.stopsRemaining).toBe(route.length - 1);

    // Edge case: advancing past destination should clamp at terminus without crash
    for (let i = 0; i < route.length + 5; i++) {
      trip.advanceStation();
    }
    expect(trip.currentState.lastStation).toBe(route[route.length - 1].name);
    expect(trip.currentState.stopsRemaining).toBe(0);

    trip.cancel();
  });

  it('rejects noisy GPS fixes above-ground (>80m) but accepts cell tower accuracy underground (up to 600m)', () => {
    const trip = new TripController(delhiNetwork, () => {});
    const startTime = 1_760_000_000_000;
    const route = trip.arm({
      enteredAtId: 'rajiv-chowk',
      destId: 'chandni-chowk',
      bufferStops: 1,
      now: startTime,
    });

    const targetStation = route[1];

    // Above ground: fix with accuracy 120m is rejected
    trip.onFix({
      lat: targetStation.lat,
      lon: targetStation.lon,
      accuracy: 120,
      speed: 10,
      ts: startTime + 10_000,
    });
    expect(trip.currentState.lastStation).toBe(route[0].name);

    // Train enters tunnel and loses GPS for 45 seconds -> becomes underground
    trip.tick(startTime + 45_000);
    expect(trip.currentState.isUnderground).toBe(true);

    // Underground: fix with accuracy 150m (cell tower) is accepted and snaps station
    trip.onFix({
      lat: targetStation.lat,
      lon: targetStation.lon,
      accuracy: 150,
      speed: 10,
      ts: startTime + 46_000,
    });
    expect(trip.currentState.lastStation).toBe(targetStation.name);

    // Underground: wildly inaccurate fix (>600m) is still rejected
    const farStation = route.at(-1)!;
    trip.onFix({
      lat: farStation.lat,
      lon: farStation.lon,
      accuracy: 750,
      speed: 10,
      ts: startTime + 50_000,
    });
    expect(trip.currentState.lastStation).toBe(targetStation.name);

    trip.cancel();
  });

  it('maintains delay hold when accelerometer reports movement while train is delayed', () => {
    const trip = new TripController(delhiNetwork, () => {});
    const startTime = 1_760_000_000_000;
    trip.arm({
      enteredAtId: 'rajiv-chowk',
      destId: 'chandni-chowk',
      bufferStops: 1,
      now: startTime,
    });

    // Rider sets train delayed
    trip.setTrainDelayed(true);
    expect(trip.currentState.isTrainDelayed).toBe(true);
    expect(trip.currentState.isDwelling).toBe(true);

    // Phone accelerometer detects vibration / movement, but delay toggle is active
    trip.setMotion(true);
    expect(trip.currentState.isDwelling).toBe(true);
    expect(trip.currentState.isTrainDelayed).toBe(true);

    // onFix with moving=true also does not clear dwelling while train is delayed
    trip.onFix({
      lat: 28.632,
      lon: 77.219,
      accuracy: 20,
      speed: 0,
      ts: startTime + 15_000,
      moving: true,
    });
    expect(trip.currentState.isDwelling).toBe(true);

    trip.cancel();
  });

  it('handles zero buffer stops (alarm triggers only at destination)', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const route = trip.arm({
      enteredAtId: 'dwarka-sector-21',
      destId: 'vaishali',
      bufferStops: 0, // Zero buffer stops
    });

    // Replay up to destination minus 1
    const atDestMinus1 = route.length - 2;
    for (const fix of replay(route, atDestMinus1)) {
      trip.onFix(fix);
    }
    // Must NOT alarm at destination minus 1 when buffer is 0
    expect(trip.currentState.state).toBe('riding');
    expect(MetroAlarm.startAlarm).not.toHaveBeenCalled();

    // Replay into destination station
    for (const fix of replay(route, route.length - 1)) {
      trip.onFix(fix);
    }
    // Alarm fired at destination, and after reaching terminus platform, state concludes
    expect(MetroAlarm.startAlarm).toHaveBeenCalled();
    expect(states.some(s => s.state === 'alarmed')).toBe(true);
    expect(trip.currentState.state).toBe('done');

    trip.cancel();
  });

  it('interchange alarm dismissal does not block final destination alarm on multi-leg routes', () => {
    const { planAlternates } = require('../src/metro/planner');
    const plans = planAlternates(delhiNetwork, 'noida-sector-18', 'hauz-khas');
    const transferPlan = plans.find((p: any) => p.changes >= 1);
    expect(transferPlan).toBeDefined();

    const trip = new TripController(delhiNetwork, () => {});
    const route = trip.arm({
      enteredAtId: 'noida-sector-18',
      destId: 'hauz-khas',
      bufferStops: 1,
      plan: transferPlan,
    });

    // Replay approaching interchange (<2500m but before 180m arrival)
    const icIndex = route.findIndex(s => s.id === transferPlan.legs[0].alightId);
    expect(icIndex).toBeGreaterThan(0);

    const approachingFixes = replay(route, icIndex);
    for (const fix of approachingFixes.slice(0, Math.max(3, Math.floor(approachingFixes.length * 0.7)))) {
      trip.onFix(fix);
    }
    expect(trip.currentState.state).toBe('interchange_alarm');

    // Dismiss interchange alarm
    trip.dismiss();
    expect(trip.currentState.state).toBe('interchanging');

    // Transfer completed -> advance to leg 2
    trip.advanceInterchange();
    expect(trip.currentState.state).toBe('riding');

    // Progress along leg 2 towards final destination
    (MetroAlarm.startAlarm as jest.Mock).mockClear();
    for (const fix of replay(route, route.length - 2, icIndex)) {
      trip.onFix(fix);
    }

    // Destination alarm MUST fire even though interchange alarm was previously dismissed
    expect(trip.currentState.state).toBe('alarmed');
    expect(MetroAlarm.startAlarm).toHaveBeenCalled();

    trip.cancel();
  });

  it('snoozes active alarm and re-triggers after snooze timer elapses', () => {
    jest.useFakeTimers();
    try {
      const trip = new TripController(delhiNetwork, () => {});
      const route = trip.arm({
        enteredAtId: 'dwarka-sector-21',
        destId: 'vaishali',
        bufferStops: 1,
      });

      const atDestMinus1 = route.length - 2;
      for (const fix of replay(route, atDestMinus1)) {
        trip.onFix(fix);
      }
      expect(trip.currentState.state).toBe('alarmed');

      // Snooze for 2 minutes
      trip.snooze(2);
      expect(trip.currentState.state).toBe('riding');
      expect(MetroAlarm.stopAlarm).toHaveBeenCalled();
      expect(MetroAlarm.scheduleAlarm).toHaveBeenCalledWith(expect.any(Number));

      // Clear mock call count
      (MetroAlarm.startAlarm as jest.Mock).mockClear();

      // Fast forward 2 minutes
      jest.advanceTimersByTime(2 * 60 * 1000);

      // Alarm should re-trigger
      expect(trip.currentState.state).toBe('alarmed');
      expect(MetroAlarm.startAlarm).toHaveBeenCalled();

      trip.cancel();
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancel resets all internal tracking and stops all alarms cleanly', () => {
    const trip = new TripController(delhiNetwork, () => {});
    trip.arm({
      enteredAtId: 'rajiv-chowk',
      destId: 'chandni-chowk',
      bufferStops: 1,
    });
    trip.setTrainDelayed(true);

    trip.cancel();

    expect(trip.currentState.state).toBe('idle');
    expect(trip.currentState.lastStation).toBeNull();
    expect(trip.currentState.stopsRemaining).toBeNull();
    expect(trip.currentState.isTrainDelayed).toBe(false);
    expect(trip.currentState.isDwelling).toBe(false);
    expect(MetroAlarm.stopAlarm).toHaveBeenCalled();
    expect(MetroAlarm.cancelScheduledAlarm).toHaveBeenCalled();
  });

  it('successfully tracks and triggers interchange alarm on Pink Line underground with zero GPS fixes', () => {
    const states: TripSnapshot[] = [];
    const trip = new TripController(delhiNetwork, s => states.push({ ...s }));
    const startTime = 1_760_000_000_000;

    // Pink Line underground trip: South Extension -> Rajiv Chowk (transfer at Dilli Haat - INA)
    const route = trip.arm({
      enteredAtId: 'south-extension',
      destId: 'rajiv-chowk',
      bufferStops: 1,
      now: startTime,
    });

    expect(route[0].id).toBe('south-extension');
    // Origin platform dwell
    expect(trip.currentState.isDwelling).toBe(true);

    // 45 seconds later, in underground tunnel with zero GPS fixes: train departs platform
    trip.tick(startTime + 45_000);
    expect(trip.currentState.isDwelling).toBe(false);
    expect(trip.currentState.isUnderground).toBe(true);

    // Station cursor is at 0 (South Extension), next station is Dilli Haat - INA (interchange!)
    // stopsToIc is 1 - 0 = 1 <= bufferStops
    expect(trip.currentState.state).toBe('interchange_alarm');
    expect(MetroAlarm.startAlarm).toHaveBeenCalled();
    expect(trip.currentState.interchange?.stationName).toContain('INA');

    trip.cancel();
  });

  it('gracefully auto-advances to second leg if passenger falls asleep at underground interchange platform', () => {
    const trip = new TripController(delhiNetwork, () => {});
    const startTime = 1_760_000_000_000;

    const route = trip.arm({
      enteredAtId: 'south-extension',
      destId: 'rajiv-chowk',
      bufferStops: 1,
      now: startTime,
    });

    // Depart origin and reach interchange
    trip.tick(startTime + 45_000);
    // Dismiss interchange alarm upon arriving at platform
    trip.dismiss(startTime + 45_000);
    expect(trip.currentState.state).toBe('interchanging');

    // 4.5 minutes pass while walking/waiting at platform, passenger boards connecting train
    trip.tick(startTime + 45_000 + 250_000);

    // Should have gracefully advanced to leg 2 (riding on Yellow Line)
    expect(trip.currentState.state).toBe('riding');
    expect(trip.currentState.lastStation).not.toBeNull();
    expect(trip.currentState.stopsRemaining).toBeLessThan(route.length - 1);

    trip.cancel();
  });

  it('gracefully detects if rider misses interchange and continues on the wrong train', () => {
    const trip = new TripController(delhiNetwork, () => {});
    // Trip: Noida Sector 18 -> Hauz Khas (planned interchange at Botanical Garden)
    trip.arm({
      enteredAtId: 'noida-sector-18',
      destId: 'hauz-khas',
      bufferStops: 1,
    });

    // Rider arrives at Botanical Garden
    trip.onFix({ lat: 28.5639, lon: 77.3343, accuracy: 10, speed: 0, ts: 1_760_000_000_000 });
    trip.dismiss();
    expect(trip.currentState.state).toBe('interchanging');

    // But rider stayed on Blue Line train towards Noida Sector 34!
    // Noida Sec 34 coords: lat ~28.5802, lon ~77.3635 (off planned Magenta route to Hauz Khas)
    const sec34Fix: Fix = {
      lat: 28.5802,
      lon: 77.3635,
      accuracy: 10,
      speed: 12,
      ts: 1_760_000_300_000,
    };

    trip.onFix(sec34Fix);
    trip.onFix({ ...sec34Fix, ts: 1_760_000_305_000 });

    // Gracefully detects off-route recovery mode
    expect(trip.currentState.state).toBe('wrong_trip');
    expect(trip.currentState.recovery).not.toBeNull();
    expect(trip.currentState.recovery?.recalculatedPlan).not.toBeNull();

    trip.cancel();
  });
});



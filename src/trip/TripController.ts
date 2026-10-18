import type { NetworkData } from '../metro/data';
import { planFastest, type Plan } from '../metro/planner';
import { MetroAlarm } from '../native/MetroAlarm';

/**
 * TripController (D-007, P1 GPS-first): the rider declares the station they
 * ENTERED at and their destination; GPS fixes snap onto that route's stations;
 * the alarm fires when the train is N stops (buffer) from the destination.
 *
 * Reconciliation rule: anchors are authoritative when they arrive; between
 * anchors an ETA estimate from the data pack's inter-station times drives a
 * soft countdown. Every state change is reported via onState for the UI.
 */

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number;
  ts: number;
}

export type TripState = 'idle' | 'riding' | 'alarmed' | 'done';

export interface TripSnapshot {
  state: TripState;
  /** last confirmed station on the route */
  lastStation: string | null;
  /** estimated stops remaining to destination (may be fractional via ETA) */
  stopsRemaining: number | null;
  /** meters to destination straight-line */
  distM: number | null;
  /** ETA seconds to destination from the data pack (if anchored) */
  etaS: number | null;
}

const SNAP_RADIUS_M = 250; // station anchor snap threshold (tunable per doc §6.1)
const ALARM_CONFIRMATIONS = 2; // consecutive windows at-or-below buffer before firing
const ARRIVE_RADIUS_M = 180;

const R = 6371e3;
export const hav = (a: Fix | { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLon = (b.lon - a.lon) * p;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export interface StationPin {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** seconds from this station to the next one on the route */
  toNextS: number;
}

export class TripController {
  private route: StationPin[] = [];
  private cursor = 0; // index of last confirmed station
  private confirmCount = 0;
  private state: TripState = 'idle';
  private bufferStops = 1;
  private fired = false;
  private lastAnchorTs = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private snoozeTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: TripSnapshot = {
    state: 'idle',
    lastStation: null,
    stopsRemaining: null,
    distM: null,
    etaS: null,
  };

  constructor(
    private network: NetworkData,
    private onState: (s: TripSnapshot) => void,
  ) {}

  /**
   * Plan the route for a station entered at and a destination, return station
   * pins for the UI lat/lon visibility, and switch to 'riding'.
   */
  arm(opts: { enteredAtId: string; destId: string; bufferStops: number }): StationPin[] {
    const plan: Plan | null = planFastest(this.network, opts.enteredAtId, opts.destId);
    if (!plan || plan.legs.length === 0) {
      throw new Error('No route found between the selected stations');
    }
    this.route = [];
    for (const leg of plan.legs) {
      // stations come as ordered list per leg; fetch pins from the network pack
      const pins = leg.stations
        .map((st) => this.pinFor(st.id))
        .filter((p): p is StationPin => p != null);
      for (const pin of pins) {
        if (this.route.length === 0 || this.route.at(-1)!.id !== pin.id) {
          this.route.push(pin);
        }
      }
    }
    this.bufferStops = opts.bufferStops;
    this.cursor = 0;
    this.confirmCount = 0;
    this.fired = false;
    this.state = 'riding';
    this.lastAnchorTs = Date.now();
    this.startTicker();
    this.rescheduleWatchdog();
    this.publish();
    return this.route;
  }

  /** Feed a GPS fix (from MetroTripLocation events or a simulated replay). */
  onFix(fix: Fix) {
    if (this.state !== 'riding' || this.route.length === 0) return;
    // Noisy underground/smart-accuracy fixes must never move the anchor
    // (sensor-fusion tolerance; per doc §6.2 accuracy-better-than-50 m heuristic,
    // we accept up to 80 m here since station anchors have slack).
    if (fix.accuracy > 80) return;

    this.lastAnchorTs = fix.ts || Date.now();

    // 1. anchor: nearest route station within snap radius, advancing forward only
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = this.cursor; i < this.route.length; i++) {
      const d = hav(fix, this.route[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDist <= SNAP_RADIUS_M) {
      if (bestIdx > this.cursor) {
        this.cursor = bestIdx;
        this.rescheduleWatchdog();
      }
    }

    // 2. window check with confirmation (anti-jitter)
    const stopsRemaining = this.route.length - 1 - this.cursor;
    const destPin = this.route.at(-1)!;
    const distToDest = hav(fix, destPin);

    // ETA view: fractional stops via remaining time (soft signal)
    let etaRemainS = 0;
    for (let i = this.cursor; i < this.route.length - 1; i++) {
      etaRemainS += this.route[i].toNextS;
    }

    if (this.cursor >= this.route.length - 1 && distToDest <= ARRIVE_RADIUS_M) {
      this.state = 'done';
      this.stopTicker();
      void MetroAlarm.cancelScheduledAlarm();
      void MetroAlarm.stopAlarm();
      this.publish(0, distToDest, 0);
      return;
    }

    if (!this.fired && stopsRemaining <= this.bufferStops && distToDest < 2500) {
      this.confirmCount += 1;
      if (this.confirmCount >= ALARM_CONFIRMATIONS) {
        this.triggerAlarm();
      }
    } else if (stopsRemaining > this.bufferStops + 1) {
      this.confirmCount = 0;
    }

    this.publish(
      stopsRemaining,
      distToDest,
      etaRemainS,
    );
  }

  /**
   * Periodic tick (called every sec or on demand) to provide an underground ETA
   * countdown fallback when GPS fixes cease (D-007 §6.7).
   */
  tick(now: number = Date.now()) {
    if (this.state !== 'riding' || this.route.length === 0) return;
    const elapsedS = Math.max(0, Math.floor((now - this.lastAnchorTs) / 1000));

    let totalRemainS = 0;
    for (let i = this.cursor; i < this.route.length - 1; i++) {
      totalRemainS += this.route[i].toNextS;
    }
    const etaRemainS = Math.max(0, totalRemainS - elapsedS);

    // Time to target alarm station (N stops before destination)
    const targetIdx = Math.max(0, this.route.length - 1 - this.bufferStops);
    let toBufferS = 0;
    for (let i = this.cursor; i < targetIdx; i++) {
      toBufferS += this.route[i].toNextS;
    }

    // If underground without GPS fixes for >= toBufferS, trigger ETA fallback alarm
    if (!this.fired && elapsedS >= toBufferS && toBufferS >= 0) {
      this.triggerAlarm();
    }

    // Fractional stops remaining via remaining travel time
    const stopsFromCursor = this.route.length - 1 - this.cursor;
    const estStopsRemaining =
      totalRemainS > 0
        ? Math.max(0, (etaRemainS / totalRemainS) * stopsFromCursor)
        : 0;

    this.publish(estStopsRemaining, this.snapshot.distM ?? undefined, etaRemainS);
  }

  private triggerAlarm() {
    this.fired = true;
    this.state = 'alarmed';
    void MetroAlarm.startAlarm();
  }

  private rescheduleWatchdog() {
    const targetIdx = Math.max(0, this.route.length - 1 - this.bufferStops);
    let seconds = 0;
    for (let i = this.cursor; i < targetIdx; i++) {
      seconds += this.route[i].toNextS;
    }
    // Schedule native alarm watchdog at estimated buffer arrival timestamp
    const triggerAt = Date.now() + Math.max(10, seconds) * 1000;
    void MetroAlarm.scheduleAlarm(triggerAt);
  }

  private startTicker() {
    this.stopTicker();
    // ponytail: interval tick fallback for underground countdown; cancelled on trip end
    const t = setInterval(() => this.tick(), 1000);
    (t as any).unref?.();
    this.ticker = t;
  }

  private stopTicker() {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    if (this.snoozeTimer) {
      clearTimeout(this.snoozeTimer);
      this.snoozeTimer = null;
    }
  }

  /** Snooze alarm for X minutes (silences audio, re-triggers later). */
  snooze(minutes = 3) {
    void MetroAlarm.stopAlarm();
    this.fired = false;
    this.state = 'riding';
    const delayMs = minutes * 60 * 1000;
    void MetroAlarm.scheduleAlarm(Date.now() + delayMs);
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
    const st = setTimeout(() => {
      if (this.state === 'riding') {
        this.triggerAlarm();
      }
    }, delayMs);
    (st as any).unref?.();
    this.snoozeTimer = st;
    this.publish();
  }

  /** Dismiss the alarm (UI button). */
  dismiss() {
    if (this.state === 'alarmed') {
      void MetroAlarm.stopAlarm();
      void MetroAlarm.cancelScheduledAlarm();
      if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
      this.state = 'riding';
      this.publish();
    }
  }

  cancel() {
    this.state = 'idle';
    this.route = [];
    this.fired = false;
    this.stopTicker();
    void MetroAlarm.cancelScheduledAlarm();
    void MetroAlarm.stopAlarm();
    this.publish();
  }

  get currentState(): TripSnapshot {
    return this.snapshot;
  }

  private pinFor(stationId: string): StationPin | null {
    for (const line of this.network.lines) {
      for (const seg of line.segments) {
        for (let i = 0; i < seg.stations.length; i++) {
          const st = seg.stations[i];
          if (st.id === stationId && st.lat != null && st.lon != null) {
            const next = seg.stations[i + 1];
            return {
              id: st.id,
              name: st.name,
              lat: st.lat,
              lon: st.lon,
              toNextS: next?.toNextS ?? 160,
            };
          }
        }
      }
    }
    return null;
  }

  private publish(stopsRemaining?: number, distM?: number, etaS?: number) {
    const pin = this.route[this.cursor];
    this.snapshot = {
      state: this.state,
      lastStation: pin?.name ?? null,
      stopsRemaining: stopsRemaining ?? this.snapshot.stopsRemaining,
      distM: distM ?? this.snapshot.distM,
      etaS: etaS ?? this.snapshot.etaS,
    };
    this.onState(this.snapshot);
  }
}

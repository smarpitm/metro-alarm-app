import type { NetworkData, StationCoord } from '../metro/data';
import { collectStationsWithCoords } from '../metro/data';
import { planFastest, type Plan } from '../metro/planner';
import { getPlatformGuidance, formatInterchangeInstruction } from '../metro/interchange';
import { MetroAlarm } from '../native/MetroAlarm';

/**
 * TripController: the rider declares entered station and destination;
 * GPS fixes snap onto the route's stations.
 *
 * Features:
 *  - Advance alarm at N stops before destination (buffer) based on physical distance & stops
 *  - Advance alarm before interchange stations with next-line and platform guidance
 *  - Automatic "boarded next train" transition at interchanges
 *  - Dwell-aware ETA: holds ETA when waiting/stopped at any station or interchange
 *  - Recovery mode: alerts and offers 1-tap re-routing if rider takes wrong train/direction
 *  - Adaptive battery modes (economy/approaching) for lower battery consumption
 *  - Underground dead-reckoning fallback only during active motion
 */

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number;
  ts: number;
}

export type TripState =
  | 'idle'
  | 'riding'
  | 'interchange_alarm'
  | 'interchanging'
  | 'wrong_trip'
  | 'alarmed'
  | 'done';

export interface InterchangeAlert {
  stationId: string;
  stationName: string;
  toLineId: string;
  toLineName: string;
  toAlightName: string;
  platform?: string | null;
  instruction: string;
  stopsUntil: number;
}

export interface RecoveryAlert {
  currentStationId: string;
  currentStationName: string;
  destinationId: string;
  destinationName: string;
  recalculatedPlan: Plan | null;
  reason: 'off_route' | 'wrong_direction';
  message: string;
}

export interface TripSnapshot {
  state: TripState;
  /** last confirmed station on the route */
  lastStation: string | null;
  /** estimated stops remaining to destination (may be fractional via ETA) */
  stopsRemaining: number | null;
  /** meters to destination straight-line (primary physical metric) */
  distM: number | null;
  /** ETA seconds to destination from data pack, including transfer penalties */
  etaS: number | null;
  /** active interchange alert or next interchange details */
  interchange?: InterchangeAlert | null;
  /** active recovery alert when off-route or wrong direction detected */
  recovery?: RecoveryAlert | null;
  /** true when rider is dwelling/waiting at a station or interchange platform */
  isDwelling?: boolean;
  /** battery optimization mode */
  batteryMode?: 'economy' | 'balanced' | 'approaching';
}

interface InterchangePoint {
  routeIndex: number;
  stationId: string;
  stationName: string;
  toLineId: string;
  toLineName: string;
  toAlightName: string;
  platform: string | null;
  alerted: boolean;
}

const SNAP_RADIUS_M = 250;
const ALARM_CONFIRMATIONS = 2;
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
  private interchanges: InterchangePoint[] = [];
  private cursor = 0; // index of last confirmed station
  private confirmCount = 0;
  private state: TripState = 'idle';
  private bufferStops = 1;
  private fired = false;
  private lastAnchorTs = 0;
  private lastMotionTs = 0;
  private isDwelling = true;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private snoozeTimer: ReturnType<typeof setTimeout> | null = null;

  // Recovery & wrong-trip tracking
  private enteredAtId = '';
  private destId = '';
  private destName = '';
  private offRouteCount = 0;
  private wrongDirCount = 0;
  private recovery: RecoveryAlert | null = null;
  private allCoords: StationCoord[] = [];
  private batteryMode: 'economy' | 'balanced' | 'approaching' = 'balanced';

  private snapshot: TripSnapshot = {
    state: 'idle',
    lastStation: null,
    stopsRemaining: null,
    distM: null,
    etaS: null,
    interchange: null,
    recovery: null,
    isDwelling: false,
    batteryMode: 'balanced',
  };

  constructor(
    private network: NetworkData,
    private onState: (s: TripSnapshot) => void,
  ) {
    this.allCoords = collectStationsWithCoords(this.network);
  }

  private buildRouteFromPlan(plan: Plan) {
    this.route = [];
    this.interchanges = [];

    for (let legIdx = 0; legIdx < plan.legs.length; legIdx++) {
      const leg = plan.legs[legIdx];
      const nextLeg = plan.legs[legIdx + 1];
      const pins = leg.stations
        .map((st) => this.pinFor(st.id, leg.lineId))
        .filter((p): p is StationPin => p != null);

      for (const pin of pins) {
        if (this.route.length === 0 || this.route.at(-1)!.id !== pin.id) {
          this.route.push(pin);
        }
      }

      if (nextLeg) {
        const interchangeStationIdx = this.route.length - 1;
        const plat = getPlatformGuidance(leg.alightId, nextLeg.lineId, nextLeg.alightName);
        this.interchanges.push({
          routeIndex: interchangeStationIdx,
          stationId: leg.alightId,
          stationName: leg.alightName,
          toLineId: nextLeg.lineId,
          toLineName: nextLeg.lineName,
          toAlightName: nextLeg.alightName,
          platform: plat,
          alerted: false,
        });
      }
    }
  }

  /**
   * Plan the route for a station entered at and a destination, return station
   * pins for the UI lat/lon visibility, and switch to 'riding'.
   */
  arm(opts: { enteredAtId: string; destId: string; bufferStops: number }): StationPin[] {
    const plan: Plan | null = planFastest(this.network, opts.enteredAtId, opts.destId);
    if (!plan || plan.legs.length === 0) {
      throw new Error('No route found between the selected stations');
    }

    this.enteredAtId = opts.enteredAtId;
    this.destId = opts.destId;
    this.buildRouteFromPlan(plan);

    const destStation = this.route.at(-1);
    this.destName = destStation ? destStation.name : opts.destId;

    this.bufferStops = opts.bufferStops;
    this.cursor = 0;
    this.confirmCount = 0;
    this.fired = false;
    this.state = 'riding';
    this.isDwelling = true; // Started at origin station
    this.lastAnchorTs = Date.now();
    this.lastMotionTs = Date.now();
    this.offRouteCount = 0;
    this.wrongDirCount = 0;
    this.recovery = null;
    this.batteryMode = 'balanced';

    this.startTicker();
    this.rescheduleWatchdog();
    this.publish(
      this.route.length - 1,
      hav(this.route[0], this.route.at(-1)!),
      this.calculateRemainingEtaS(0),
    );
    return this.route;
  }

  /** Feed a GPS fix (from MetroTripLocation events or a simulated replay). */
  onFix(fix: Fix) {
    if (this.state === 'idle' || this.state === 'done' || this.route.length === 0) return;
    if (fix.accuracy > 80) return;

    this.lastAnchorTs = fix.ts || Date.now();

    // Dwell vs Motion check
    if (fix.speed >= 2.5) {
      // In motion between stations
      this.isDwelling = false;
      this.lastMotionTs = fix.ts || Date.now();
    } else if (fix.speed < 1.5) {
      // Stationary or low speed: check if near confirmed station or interchange
      const curPin = this.route[this.cursor];
      if (curPin && hav(fix, curPin) <= SNAP_RADIUS_M + 50) {
        this.isDwelling = true;
      }
    }

    // 1. Anchor: nearest route station within snap radius, advancing forward only
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
        this.isDwelling = true; // Just arrived at station; wait for departure
        this.offRouteCount = 0;
        this.wrongDirCount = 0;
        this.rescheduleWatchdog();

        // If we advanced past an interchange station, transition back to riding
        const activeIc = this.interchanges.find(ic => ic.routeIndex < this.cursor);
        if (activeIc && (this.state === 'interchanging' || this.state === 'interchange_alarm')) {
          this.state = 'riding';
        }
      } else if (bestIdx === this.cursor) {
        this.offRouteCount = 0;
        this.wrongDirCount = 0;
      }
    }

    // 2. Automatic "Boarded next train" at interchange:
    // If the rider is in 'interchanging' state, check if they have moved towards or reached
    // the next leg's station automatically without needing manual tap.
    const activeIc = this.interchanges.find(ic => ic.routeIndex >= this.cursor);
    if ((this.state === 'interchanging' || this.state === 'interchange_alarm') && activeIc) {
      const nextLegFirstIdx = activeIc.routeIndex + 1;
      if (nextLegFirstIdx < this.route.length) {
        const nextLegPin = this.route[nextLegFirstIdx];
        const distToNextLeg = hav(fix, nextLegPin);
        const distToIc = hav(fix, this.route[activeIc.routeIndex]);

        // If snapped to next leg station OR moving away from interchange towards next leg
        if (
          distToNextLeg <= SNAP_RADIUS_M ||
          (distToIc > 300 && distToNextLeg < hav(this.route[activeIc.routeIndex], nextLegPin) && fix.speed >= 2.0)
        ) {
          this.advanceInterchange();
          this.isDwelling = false;
          this.lastMotionTs = fix.ts || Date.now();
        }
      }
    }

    // 3. Off-route / Wrong Trip / Wrong Direction detection (Recovery Mode)
    if (this.state === 'riding' && bestDist > 700) {
      // Check backwards progress along previous stations on route
      let backwardsIdx = -1;
      let minBackDist = Infinity;
      for (let i = 0; i < this.cursor; i++) {
        const d = hav(fix, this.route[i]);
        if (d < minBackDist) {
          minBackDist = d;
          backwardsIdx = i;
        }
      }

      if (backwardsIdx >= 0 && minBackDist <= 280) {
        this.wrongDirCount += 1;
        if (this.wrongDirCount >= 2) {
          this.triggerWrongTrip(this.route[backwardsIdx], 'wrong_direction');
          return;
        }
      } else {
        // Check nearest station across the entire metro network
        let nearestNet: StationCoord | null = null;
        let minNetDist = Infinity;
        for (const s of this.allCoords) {
          const d = hav(fix, s);
          if (d < minNetDist) {
            minNetDist = d;
            nearestNet = s;
          }
        }

        if (nearestNet && minNetDist <= 280) {
          const isAheadOnRoute = this.route.slice(this.cursor).some(p => p.id === nearestNet!.id);
          if (!isAheadOnRoute) {
            this.offRouteCount += 1;
            if (this.offRouteCount >= 2) {
              this.triggerWrongTrip(nearestNet, 'off_route');
              return;
            }
          }
        }
      }
    }

    const stopsRemaining = this.route.length - 1 - this.cursor;
    const destPin = this.route.at(-1)!;
    const distToDest = hav(fix, destPin);

    // Battery policy optimization
    const desiredMode = stopsRemaining > 3 && distToDest > 3500 ? 'economy' : 'approaching';
    if (this.batteryMode !== desiredMode) {
      this.batteryMode = desiredMode;
      MetroAlarm.setTrackingMode?.(desiredMode).catch(() => {});
    }

    // ETA is held fixed while dwelling at station/interchange; counts down only when moving
    const etaRemainS = this.calculateRemainingEtaS(this.cursor);

    // 4. Arrived at final destination (Distance as final metric)
    if (this.cursor >= this.route.length - 1 && distToDest <= ARRIVE_RADIUS_M) {
      this.state = 'done';
      this.stopTicker();
      MetroAlarm.cancelScheduledAlarm().catch(() => {});
      MetroAlarm.stopAlarm().catch(() => {});
      this.publish(0, distToDest, 0);
      return;
    }

    // 5. Interchange arrival / advance alarm
    const nextIc = this.interchanges.find(ic => ic.routeIndex >= this.cursor);
    if (nextIc) {
      const stopsToIc = nextIc.routeIndex - this.cursor;
      const distToIc = hav(fix, this.route[nextIc.routeIndex]);

      if (this.cursor === nextIc.routeIndex || distToIc <= ARRIVE_RADIUS_M) {
        this.state = 'interchanging';
        this.isDwelling = true;
        MetroAlarm.stopAlarm().catch(() => {});
      } else if (!nextIc.alerted && stopsToIc <= this.bufferStops && distToIc < 2500) {
        this.confirmCount += 1;
        if (this.confirmCount >= ALARM_CONFIRMATIONS) {
          this.triggerInterchangeAlarm(nextIc);
        }
      } else if (stopsToIc > this.bufferStops + 1) {
        this.confirmCount = 0;
      }
    } else {
      // 6. Destination alarm check (Distance as final metric)
      if (!this.fired && stopsRemaining <= this.bufferStops && distToDest < 2500) {
        this.confirmCount += 1;
        if (this.confirmCount >= ALARM_CONFIRMATIONS) {
          this.triggerAlarm();
        }
      } else if (stopsRemaining > this.bufferStops + 1) {
        this.confirmCount = 0;
      }
    }

    this.publish(stopsRemaining, distToDest, etaRemainS);
  }

  /**
   * Periodic tick for underground fallback when in active motion.
   * If rider is dwelling/waiting at a station or interchange, tick pauses ETA
   * decrement to avoid falsely advancing stops or firing alarms while stationary.
   */
  tick(now: number = Date.now()) {
    if ((this.state !== 'riding' && this.state !== 'interchanging') || this.route.length === 0) return;

    // Requirement: "If somebody spends time at any station ya interchange wait for them to move to next station before changing the eta"
    if (this.isDwelling) {
      const totalRemainS = this.calculateRemainingEtaS(this.cursor);
      const stopsFromCursor = this.route.length - 1 - this.cursor;
      this.publish(stopsFromCursor, this.snapshot.distM ?? undefined, totalRemainS);
      return;
    }

    const elapsedS = Math.max(0, Math.floor((now - (this.lastMotionTs || this.lastAnchorTs)) / 1000));
    const totalRemainS = this.calculateRemainingEtaS(this.cursor);
    const etaRemainS = Math.max(0, totalRemainS - elapsedS);

    // Underground fallback alarm when actively moving between stations
    const nextIc = this.interchanges.find(ic => ic.routeIndex > this.cursor && !ic.alerted);
    if (nextIc) {
      const targetIdx = Math.max(this.cursor, nextIc.routeIndex - this.bufferStops);
      let toBufferS = 0;
      for (let i = this.cursor; i < targetIdx; i++) {
        toBufferS += this.route[i].toNextS;
      }
      if (this.state === 'riding' && elapsedS >= toBufferS && toBufferS > 0) {
        this.triggerInterchangeAlarm(nextIc);
      }
    } else {
      const targetIdx = Math.max(0, this.route.length - 1 - this.bufferStops);
      let toBufferS = 0;
      for (let i = this.cursor; i < targetIdx; i++) {
        toBufferS += this.route[i].toNextS;
      }
      if (!this.fired && this.state === 'riding' && elapsedS >= toBufferS && toBufferS > 0) {
        this.triggerAlarm();
      }
    }

    // Fractional stops remaining via remaining travel time while moving
    const stopsFromCursor = this.route.length - 1 - this.cursor;
    const estStopsRemaining =
      totalRemainS > 0
        ? Math.max(0, (etaRemainS / totalRemainS) * stopsFromCursor)
        : 0;

    this.publish(estStopsRemaining, this.snapshot.distM ?? undefined, etaRemainS);
  }

  /** Trigger recovery mode when rider is detected off-route or going wrong way. */
  private triggerWrongTrip(station: { id: string; name: string }, reason: 'off_route' | 'wrong_direction') {
    this.state = 'wrong_trip';
    MetroAlarm.stopAlarm().catch(() => {});
    let recalculatedPlan: Plan | null = null;
    try {
      recalculatedPlan = planFastest(this.network, station.id, this.destId);
    } catch {
      // Ignored
    }

    this.recovery = {
      currentStationId: station.id,
      currentStationName: station.name,
      destinationId: this.destId,
      destinationName: this.destName,
      recalculatedPlan,
      reason,
      message:
        reason === 'wrong_direction'
          ? `You appear to be moving backwards towards ${station.name}.`
          : `Detected at ${station.name}, which is off your planned route to ${this.destName}.`,
    };
    this.publish();
  }

  /**
   * Recalculates and updates trip route from the detected current station to destination.
   * Can accept a custom plan or uses the auto-computed recovery plan.
   */
  recalculate(plan?: Plan | null) {
    const newPlan = plan ?? this.recovery?.recalculatedPlan;
    if (!newPlan || newPlan.legs.length === 0) return;

    this.buildRouteFromPlan(newPlan);
    this.cursor = 0;
    this.confirmCount = 0;
    this.fired = false;
    this.offRouteCount = 0;
    this.wrongDirCount = 0;
    this.recovery = null;
    this.state = 'riding';
    this.isDwelling = false;
    this.lastMotionTs = Date.now();
    this.lastAnchorTs = Date.now();
    this.rescheduleWatchdog();

    this.publish(
      this.route.length - 1,
      hav(this.route[0], this.route.at(-1)!),
      this.calculateRemainingEtaS(0),
    );
  }

  /** Dismisses recovery warning and continues tracking on the original route. */
  dismissRecovery() {
    this.state = 'riding';
    this.recovery = null;
    this.offRouteCount = 0;
    this.wrongDirCount = 0;
    this.publish();
  }

  /**
   * Calculate remaining ETA seconds from cursor to destination,
   * including transferPenaltyS for every upcoming interchange ahead.
   */
  private calculateRemainingEtaS(fromCursor: number): number {
    let eta = 0;
    for (let i = fromCursor; i < this.route.length - 1; i++) {
      eta += this.route[i].toNextS;
    }
    for (const ic of this.interchanges) {
      if (ic.routeIndex > fromCursor) {
        eta += this.network.transferPenaltyS;
      }
    }
    return eta;
  }

  private triggerAlarm() {
    this.fired = true;
    this.state = 'alarmed';
    MetroAlarm.startAlarm().catch(() => {});
  }

  private triggerInterchangeAlarm(ic?: InterchangePoint) {
    if (ic) ic.alerted = true;
    this.confirmCount = 0;
    this.state = 'interchange_alarm';
    MetroAlarm.startAlarm().catch(() => {});
  }

  private rescheduleWatchdog() {
    const nextIc = this.interchanges.find(ic => ic.routeIndex > this.cursor && !ic.alerted);
    const targetIdx = nextIc
      ? Math.max(this.cursor, nextIc.routeIndex - this.bufferStops)
      : Math.max(0, this.route.length - 1 - this.bufferStops);

    let seconds = 0;
    for (let i = this.cursor; i < targetIdx; i++) {
      seconds += this.route[i].toNextS;
    }
    const triggerAt = Date.now() + Math.max(10, seconds) * 1000;
    MetroAlarm.scheduleAlarm(triggerAt).catch(() => {});
  }

  private startTicker() {
    this.stopTicker();
    const t = setInterval(() => this.tick(), 1500);
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
    MetroAlarm.stopAlarm().catch(() => {});
    const wasInterchange = this.state === 'interchange_alarm';
    this.state = 'riding';
    const delayMs = minutes * 60 * 1000;
    MetroAlarm.scheduleAlarm(Date.now() + delayMs).catch(() => {});
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
    const st = setTimeout(() => {
      if (this.state === 'riding') {
        if (wasInterchange) {
          this.triggerInterchangeAlarm();
        } else {
          this.triggerAlarm();
        }
      }
    }, delayMs);
    (st as any).unref?.();
    this.snoozeTimer = st;
    this.publish();
  }

  /** Dismiss the alarm (UI button). */
  dismiss() {
    if (this.state === 'alarmed' || this.state === 'interchange_alarm') {
      MetroAlarm.stopAlarm().catch(() => {});
      MetroAlarm.cancelScheduledAlarm().catch(() => {});
      if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
      this.state = this.state === 'interchange_alarm' ? 'interchanging' : 'riding';
      this.publish();
    }
  }

  /** Confirms transfer completed, moving on to next leg. */
  advanceInterchange() {
    if (this.state === 'interchanging' || this.state === 'interchange_alarm') {
      MetroAlarm.stopAlarm().catch(() => {});
      const nextIc = this.interchanges.find(ic => ic.routeIndex >= this.cursor);
      if (nextIc && this.cursor <= nextIc.routeIndex) {
        if (nextIc.routeIndex + 1 < this.route.length) {
          this.cursor = nextIc.routeIndex + 1;
        }
      }
      this.state = 'riding';
      this.isDwelling = false;
      this.lastMotionTs = Date.now();
      this.rescheduleWatchdog();
      this.publish();
    }
  }

  cancel() {
    this.state = 'idle';
    this.route = [];
    this.interchanges = [];
    this.fired = false;
    this.recovery = null;
    this.offRouteCount = 0;
    this.wrongDirCount = 0;
    this.isDwelling = false;
    this.stopTicker();
    MetroAlarm.cancelScheduledAlarm().catch(() => {});
    MetroAlarm.stopAlarm().catch(() => {});
    this.publish();
  }

  get currentState(): TripSnapshot {
    return this.snapshot;
  }

  private pinFor(stationId: string, lineId?: string): StationPin | null {
    if (lineId) {
      const line = this.network.lines.find(l => l.id === lineId);
      if (line) {
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
    }
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
    const nextIc = this.interchanges.find(ic => ic.routeIndex >= this.cursor);
    let interchangeAlert: InterchangeAlert | null = null;
    if (nextIc) {
      interchangeAlert = {
        stationId: nextIc.stationId,
        stationName: nextIc.stationName,
        toLineId: nextIc.toLineId,
        toLineName: nextIc.toLineName,
        toAlightName: nextIc.toAlightName,
        platform: nextIc.platform,
        instruction: formatInterchangeInstruction({
          stationName: nextIc.stationName,
          toLineName: nextIc.toLineName,
          toAlightName: nextIc.toAlightName,
          platform: nextIc.platform,
        }),
        stopsUntil: Math.max(0, nextIc.routeIndex - this.cursor),
      };
    }

    this.snapshot = {
      state: this.state,
      lastStation: pin?.name ?? null,
      stopsRemaining: stopsRemaining ?? this.snapshot.stopsRemaining,
      distM: distM ?? this.snapshot.distM,
      etaS: etaS ?? this.snapshot.etaS,
      interchange: interchangeAlert,
      recovery: this.recovery,
      isDwelling: this.isDwelling,
      batteryMode: this.batteryMode,
    };
    this.onState(this.snapshot);
  }
}

# Delhi Metro Alarm App · Comprehensive Features & Technical Implementation

This document details the core features of the Delhi Metro Alarm App along with the actual algorithms and architectural code snippets that power them.

---

## 1. Zero-GPS Underground Tunnel Dead-Reckoning & Accelerometer Fusion

### The Problem
Delhi Metro routes travel deep underground (e.g. Yellow Line through Rajiv Chowk, Kashmere Gate, Chandni Chowk, Chawri Bazar; Magenta Line through Hauz Khas; Violet Line through ITO). In concrete tunnels, satellite GPS signals drop to zero. Furthermore, trains frequently halt at red signals or hold for track clearance between stations. A naive timetable estimation would continue counting down and trigger alarms while the train is stalled in the tunnel.

### The Solution
We combine three offline mechanisms:
1. **Native 3-Axis Accelerometer Filtering**: Continuously samples device acceleration to distinguish between physical train transit and platform/signal standstill.
2. **Adaptive Platform Dwell Timeouts**: DMRC trains average 30–45s dwell at platforms before entering tunnels.
3. **Manual Rider Controls**: `⏸ Train Stopped / Delay` hold button, `🚇 Departed` trigger, and `⏮ Prev Stop` / `⏭ Next Stop` station calibration.

### Core Implementation Code

#### Native Accelerometer Vector Delta (`LocationService.kt`)
```kotlin
override fun onSensorChanged(event: SensorEvent?) {
  if (event?.sensor?.type == Sensor.TYPE_ACCELEROMETER) {
    val x = event.values[0]
    val y = event.values[1]
    val z = event.values[2]
    // Compute total acceleration magnitude
    val mag = Math.sqrt((x * x + y * y + z * z).toDouble()).toFloat()
    // Compare against standard Earth gravitational acceleration (~9.8 m/s^2)
    val diff = Math.abs(mag - 9.8f)
    val now = System.currentTimeMillis()

    // Sustained delta above 0.35 m/s^2 indicates physical train acceleration/vibration
    if (diff > 0.35f) {
      lastMotionTime = now
    }

    // Motion window: within 6 seconds of detected physical variance
    val moving = (now - lastMotionTime < 6000L)
    if (moving != lastReportedMoving) {
      lastReportedMoving = moving
      val ctx = MetroAlarmModule.appContext ?: return
      val params = Arguments.createMap().apply {
        putBoolean("moving", moving)
      }
      try {
        ctx
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("MetroMotionState", params)
      } catch (_: Exception) {}
    }
  }
}
```

#### Underground Progression State Machine (`TripController.ts`)
```typescript
// If train is halted or delayed at signal in tunnel, hold ETA fixed and do not advance
if (this.isTrainDelayed) {
  const totalRemainS = this.calculateRemainingEtaS(this.cursor);
  const stopsFromCursor = this.route.length - 1 - this.cursor;
  this.publish(stopsFromCursor, this.snapshot.distM ?? undefined, totalRemainS);
  return;
}

// Auto-dwell timeout: metro trains dwell for 30-45s at platforms, not indefinitely
if (this.isDwelling) {
  if (now - this.dwellStartTs >= DWELL_TIMEOUT_MS) {
    // Platform wait complete; train has departed into tunnel towards next station
    this.isDwelling = false;
    this.lastMotionTs = now;
  } else {
    // Still waiting at platform: hold ETA fixed
    const totalRemainS = this.calculateRemainingEtaS(this.cursor);
    const stopsFromCursor = this.route.length - 1 - this.cursor;
    this.publish(stopsFromCursor, this.snapshot.distM ?? undefined, totalRemainS);
    return;
  }
}

// Motion in transit between stations
const elapsedSinceDepartureS = Math.max(0, Math.floor((now - this.lastMotionTs) / 1000));
const toNextStationS = this.route[this.cursor]?.toNextS ?? 150;

// Underground dead-reckoning: advance station cursor when inter-station time elapses
if (this.isUnderground && this.state === 'riding' && this.cursor < this.route.length - 1) {
  if (elapsedSinceDepartureS >= toNextStationS) {
    this.cursor += 1;
    this.isDwelling = true;
    this.dwellStartTs = now;
    this.lastAnchorTs = now;
    this.rescheduleWatchdog();

    // Check if cursor advanced past an interchange
    const activeIc = this.interchanges.find(ic => ic.routeIndex < this.cursor);
    if (activeIc && (this.state === 'interchanging' || this.state === 'interchange_alarm')) {
      this.state = 'riding';
    }
  }
}
```

---

## 2. Multi-Criteria Alternate Interchange Route Planner (`planAlternates`)

### The Problem
Commuters traveling between distant parts of the city often have multiple paths available. For instance, traveling from Noida to South Delhi can be done via Mandi House (Blue $\rightarrow$ Violet) or via Botanical Garden (Blue $\rightarrow$ Magenta). Standard single-path routing forces the user onto one path.

### The Solution
`planAlternates` executes an initial fastest Dijkstra search, extracts all transfer stations along the route, and calculates alternative constrained shortest paths that specifically avoid those primary interchange hubs while pruning paths that exceed a $1.7\times$ travel time threshold.

### Core Implementation Code (`planner.ts`)
```typescript
export function planAlternates(
  network: NetworkData,
  originId: string,
  destId: string,
  maxAlternates: number = 3,
): Plan[] {
  if (originId === destId) return [];

  const results: Plan[] = [];
  const planSignature = (p: Plan) =>
    p.legs.map(l => `${l.lineId}@${l.alightId}`).join('|');
  const seenSignatures = new Set<string>();

  // 1. Compute fastest route
  const fastest = planFastest(network, originId, destId);
  if (fastest) {
    results.push(fastest);
    seenSignatures.add(planSignature(fastest));
  }

  // 2. Compute fewest transfers route
  const leastChanges = planLeastChanges(network, originId, destId);
  if (leastChanges) {
    const sig = planSignature(leastChanges);
    if (!seenSignatures.has(sig)) {
      results.push(leastChanges);
      seenSignatures.add(sig);
    }
  }

  // 3. Extract all transfer stations used in primary plans
  const primaryInterchanges = new Set<string>();
  for (const p of results) {
    for (let i = 0; i < p.legs.length - 1; i++) {
      primaryInterchanges.add(p.legs[i].alightId);
    }
  }

  // 4. Calculate alternative shortest paths avoiding primary interchange stations
  for (const avoidStationId of primaryInterchanges) {
    if (results.length >= maxAlternates + 2) break;

    for (const mode of ['fastest', 'leastChanges'] as PlanMode[]) {
      const alt = plan(network, originId, destId, mode, {
        avoidInterchanges: [avoidStationId],
      });
      if (alt && alt.legs.length > 0) {
        const sig = planSignature(alt);
        if (!seenSignatures.has(sig)) {
          // Reject paths that are absurdly longer (>1.7x fastest or >40 min penalty)
          if (!fastest || alt.timeS <= fastest.timeS * 1.7 + 1800) {
            alt.label = `🔄 Alternate Interchange (${alt.interchangeSummary})`;
            seenSignatures.add(sig);
            results.push(alt);
            if (results.length >= maxAlternates + 2) break;
          }
        }
      }
    }
  }

  return results;
}
```

---

## 3. Persistent Alarm Dismissal & Watchdog Neutralization

### The Problem
When the alarm triggered upon reaching the destination, users tapping "Dismiss" were experiencing the alarm blaring again 10 seconds later! This occurred because:
1. `rescheduleWatchdog()` computed `remainingSeconds = 0`, and scheduled a watchdog via `Math.max(10, remainingSeconds) * 1000 = 10,000ms`.
2. When the native AlarmManager fired 10s later, `AlarmService` re-sounded the alarm.

### The Solution
1. `rescheduleWatchdog()` explicitly checks `if (this.cursor >= targetIdx || this.destinationAlarmDismissed)` and calls `cancelScheduledAlarm()`.
2. A persistent dismissal timestamp (`last_dismissed_ts`) is written to `SharedPreferences`.
3. `AlarmService` enforces a 60-second suppression window against any incoming intents.

### Core Implementation Code

#### Watchdog Neutralization (`TripController.ts`)
```typescript
private rescheduleWatchdog() {
  const nextIc = this.interchanges.find(
    ic => ic.routeIndex > this.cursor && !ic.alerted && !this.dismissedInterchangeStationIds.has(ic.stationId)
  );
  // If destination alarm already dismissed or fired, never schedule!
  if (!nextIc && (this.fired || this.destinationAlarmDismissed)) {
    MetroAlarm.cancelScheduledAlarm().catch(() => {});
    return;
  }

  const targetIdx = nextIc
    ? Math.max(this.cursor, nextIc.routeIndex - this.bufferStops)
    : Math.max(0, this.route.length - 1 - this.bufferStops);

  // If targetIdx has already been reached or passed, DO NOT schedule a 10s watchdog!
  if (this.cursor >= targetIdx) {
    MetroAlarm.cancelScheduledAlarm().catch(() => {});
    return;
  }

  let seconds = 0;
  for (let i = this.cursor; i < targetIdx; i++) {
    seconds += this.route[i].toNextS;
  }
  const triggerAt = Date.now() + Math.max(10, seconds) * 1000;
  MetroAlarm.scheduleAlarm(triggerAt).catch(() => {});
}
```

#### Native SharedPreferences Guard (`AlarmService.kt`)
```kotlin
// Check if dismissed within the last 60 seconds to prevent stray watchdog re-triggering
val prefs = getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
val lastDismissed = prefs.getLong("last_dismissed_ts", 0L)
if (System.currentTimeMillis() - lastDismissed < 60_000L) {
  stopSelf()
  return START_NOT_STICKY
}
```

---

## 4. Multi-Tier Alert Modes (Sound, Vibration, Silent Notification)

* **Sound & Vibrate**: High-priority alert routed through `AudioAttributes.USAGE_ALARM` with screen wake and full volume audio.
* **Vibration Only**: Silent haptic pulse sequence using `Vibrator` patterns (`0, 800, 400, 800, 400`). Ideal for quiet coaches.
* **Silent Alert**: Posts a heads-up lock screen notification via a dedicated non-audible notification channel (`NotificationManager.IMPORTANCE_DEFAULT`), without playing audio or activating vibration motors.

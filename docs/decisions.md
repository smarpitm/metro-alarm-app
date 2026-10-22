# Decision Log (ADR-style)

Format per entry: **Decision / Why / Alternatives rejected / Consequences**.
Newest entries at the top. Keep entries small and factual; avoid re-litigating.

---

## D-008 · Route planner computed on-device, two rankings (time & transfers)
**Date:** Oct 2026 · **Status:** implemented — engine + minimal UI + local debug APK (route planner first cut)

- **Decision:** Route planning between any two stations runs 100% on-device —
  Fastest route via Dijkstra; Least-changes route via BFS on the line graph,
  then fastest-among-fewest-changes via a constrained Dijkstra.
- **Why:** The network graph is tiny (~250 stations). A Dijkstra is sub-millisecond;
  shipping queries to a server would add latency, need connectivity, and give no
  better answers. On-device = instant results even underground.
- **Alternatives rejected:** server-side routing API (latency/offline concerns);
  all-pairs precomputation (unnecessary — query-time search is already instant);
  Google Directions transit API (external dependency, no "least-changes" guarantee,
  not free at scale).
- **Consequences:** both features (alarm + planner) share one offline data pack;
  data quality (segment times) becomes the real bottleneck; performance target
  < 50 ms query-to-render must be benchmarked in a release build.

---

## D-007 · Detection = user-declared origin + layered sensor fusion, not generic positioning
**Date:** Oct 2026 · **Status:** P1 GPS path implemented (first cut) — TripController
(declared boarding station + destination, GPS snap-to-station anchors along the
planned route, N-stops-before-destination alarm with 2-confirmation window, noisy-
fix rejection, auto-detect origin via GPS fix snapped to the nearest planned station,
snooze) + LocationService foreground service streaming fixes to JS.
Accelerometer stop-counting, cell resync and ETA fallback come in P2–P4.
Station data: full-network pack generated from OSM route relations + Wikipedia
(open-station veto) via tools/data-prep/build-network.mjs; the pack now carries
per-station GPS anchors and distance-derived inter-station times
(dwell + dist / V_EFF) — still estimates until P0 rides.

- **Decision:** The app never tries to answer "which station am I standing in."
  The user declares origin & destination at trip start; runtime is a layered
  pipeline: GPS snap-anchors above ground → accelerometer stop-counting in tunnels
  (decelerate-dwell-accelerate pattern = one station passed) → cell-id/WiFi as a
  weak soft-resync → ETA-clock as last-resort fallback.
- **Why:** Station detection from arbitrary position is an unsolved indoor-positioning
  problem; counting stops between two declared points is a sensor-fusion problem a
  phone can do. Alarm semantics ("N stops before destination") need the count anyway.
- **Alternatives rejected:** radius-based "near destination" alarm (what competitors
  do — fails exactly when the rider is asleep underground); waiting for official
  live train-position APIs (none offered by DMRC).
- **Precedents:** Transit app's "underground motion detection, no GPS" blog (2024);
  Google's "Where Is My Train" cell-tower tracking method.
- **Consequences:** ±1 stop accuracy is acceptable; every false "stop" must be
  validated against inter-station time envelopes; needs empirical data collection
  rides before the matcher can be tuned.

---

## D-006 · Alarm must be native (AlarmManager + full-screen intent), decisions in JS
**Date:** Oct 2026 · **Status:** implemented (first cut) — AlarmService (looping alarm
audio + vibration + full-screen-intent notification) + AlarmActivity (show-when-locked,
turn-screen-on, explicit Dismiss) + MetroAlarmModule JS bridge (startAlarm/stopAlarm/isRinging).
No exact scheduling yet — the alarm fires the moment JS decides; AlarmManager scheduling
arrives with the ETA fallback (P4). Device verification pending: full-screen-intent grant
(Android 14+), notification permission (13+), OEM battery managers.

- **Decision:** The alarm path (exact alarm ringing, vibration, full-screen wake-up
  UI) is implemented as native Android code, not React Native JS timers.
- **Why:** JS timers die with the JS engine when the OS kills the process or the
  device sleeps. A missed alarm is a product-fatal failure, so the most critical
  path lives closest to the OS.
- **Alternatives rejected:** third-party RN alarm libraries (opaque behavior under
  Doze); polling-based JS fallbacks (dead on arrival with battery saver).
- **Consequences:** app always runs with a foreground service during an active trip;
  battery-optimization exemption must be requested from the user with an honest
  explanation; OEM battery-manager testing (Xiaomi/Samsung etc.) is mandatory.

---

## D-005 · MVP = Blue Line only, offline data pack, no backend
**Date:** Oct 2026 · **Status:** decided

- **Decision:** MVP scope is Delhi Metro Blue Line (both branches), with a static
  JSON data pack (station order, coordinates, inter-station times) shipped/bundled
  for full offline mode. No server, no API calls in MVP.
- **Why:** Scope discipline for a hackathon-style build; one verified line is worth
  more than ten unverified ones; and network requests add nothing the sensor stack
  needs (detection is offline-first by design).
- **Alternatives rejected:** multi-city support first (verification cost multiplied);
  backend-backed dynamic line data (deployment + latency for little benefit at MVP).
- **Consequences:** app must handle the Yamuna Bank branch split explicitly; any
  future lines are additive JSON, not code changes.

---

## D-004 · Data source: OpenStreetMap for stations, empirical rides for times
**Date:** Oct 2026 · **Status:** to verify during Phase P0

- **Decision:** Station lists/coordinates come from OpenStreetMap (Delhi Metro is
  well mapped); inter-station times and above/underground classification come from
  recorded data-collection rides; test the existence of a DMRC/GTFS feed for times —
  if a GTFS feed exists, stop_times gives inter-station time statistics for free.
- **Why:** OSM is permissively licensed, community-maintained, and offline-embeddable.
  Travel times from real rides beat any published timetables since dwell/segment
  times vary.
- **Alternatives rejected:** scraping DMRC website (licensing + fragility);
  hand-typed station data (error-prone, ~50 stations × fields).
- **Consequences:** Phase P0 includes building a debug "ground-truth" recording
  screen; the design doc treats current time values as placeholders.

---

## D-003 · Android first, iOS deferred
**Date:** Oct 2026 · **Status:** decided

- **Decision:** MVP ships Android-only; iOS is a Phase-after-validation port.
- **Why:** Background reliability differs enormously: Android's foreground service +
  AlarmManager can guarantee the alarm fires; iOS background restrictions make the
  *fire* UX worse, and the rider demographic's device mix + emulator/testing workflow
  favors Android.
- **Alternatives rejected:** simultaneous cross-platform (doubles reliability work
  on the part that matters most before the product is proven).
- **Consequences:** RN code is written cross-platform-cleanly (TypeScript logic is
  platform-agnostic; all OS-specific bits in native modules) so iOS is a port of 2
  native modules + app store matters, not a rewrite.

---

## D-002 · React Native (bare, 0.88) + TypeScript, not Expo
**Date:** Oct 2026 · **Status:** decided, scaffold in repo root

- **Decision:** Bare React Native 0.88 (via `@react-native-community/cli init`),
  TypeScript as shipped by the template (tsconfig + tsc + jest in the box).
- **Why:** The app's core is background-sensor heavy (background location, foreground
  service, exact alarms, accelerometer duty cycling). Bare RN gives direct access to
  native modules. Expo (even the current dev-client flavor) wraps enough of the
  native layer that the two most critical modules (AlarmManager + foreground
  service) become config-plugin detours.
- **Alternatives rejected:** Expo (managed workflow hides the native layer we must
  own); Flutter (would fragment the team's existing JS context); native-only
  Android (no cross-platform path later).
- **Consequences:** Yarn/npm choice: npm (the template's lockfile default) — package
  manager is npm, do not mix lockfiles; Node LTS required locally.

---

## D-001 · App concept: stops-remaining alarm, not clock alarm
**Date:** Oct 2026 · **Status:** decided (project founding)

- **Decision:** The product is a proximity alarm expressed in *stops* ("ring 1–2 stops
  before my destination"), not a fixed clock time.
- **Why:** Riders miss stops because attention is elsewhere; the failure mode is
  positional, not temporal. Existing apps (Don't Miss the Stop, WakeStop, Wake Me
  There — see README competitive section) approximate with GPS radius, which fails
  underground; fewest-changes/stop-distance UX is the differentiator.
- **Consequences:** every feature decision defers to "does this make the N-stops-before
  alarm fire reliably"; a missed alarm is the only product-fatal metric.

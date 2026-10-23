# Metro Alarm App 🚇⏰

A metro station reminder app that works like an alarm — it wakes/alerts the rider
when the train is approaching their destination, typically **1–2 stops before the
final destination** so they have time to gather their things and get ready to exit.

## Problem

People nap, listen to music, read, or work with their heads down on the metro and
miss their stop. Standard alarms fire at a fixed clock time, not based on *where
you are along your journey*.

## Core idea

- User picks their **destination station** on the metro line they are riding.
- The app tracks the train's progress (via GPS/location and/or line & next-station info).
- An **alarm fires when the train is N stops away from the destination** (configurable: 1 or 2 stops by default).
- Full-screen, loud, persistent alarm that works even when:
  - the screen is off,
  - the app is backgrounded,
  - the device is on battery-saver,
  - other apps / headphones are in use.

## Planned features (MVP → later)

### MVP scope decision (Oct 2026)

**The offline data pack covers all Delhi Metro lines; MVP alarm path is validated on the Blue Line.**

- One offline station table (station list in order, GPS anchors, inter-station times)
- Both branches: Dwarka Sector 21 ↔ Noida Electronic City and Yamuna Bank ↔ Vaishali
- Implication for detection: the app must treat **Yamuna Bank** as a branch split —
  the destination and observed travel direction must disambiguate Vaishali vs
  Noida Electronic City; a rider continuing straight through Yamuna Bank is NOT
  changing lines.
- No multi-city / multi-line data packs, no interchange routing, no timetable APIs.

### MVP
- [x] Select origin (auto-detect GPS fix snapped to planned station) and destination station
- [x] Choose "alarm before destination": 1 or 2 stops
- [x] GPS-based stop detection for the chosen line (snap-to-station anchors, 2-confirmation window)
- [x] Loud, looping alarm + vibration + full-screen notification that fires in the background (native AlarmService + AlarmActivity)
- [x] Snooze / dismiss controls
- [x] Offline-first (data pack bundled in the app; JS bundle embedded in debug builds for offline sideloading)
- [ ] Field validation rides (detection still needs empirical tuning — see
  `docs/station-detection.md` §9)
- [x] (bonus) Route planner: fastest & least-changes across all Delhi Metro lines
- [x] (bonus) Underground ETA-clock fallback when GPS is unreliable
- [x] (bonus) Walk-to-exit countdown after arrival

### Later
- [ ] Route planner (all lines, on-device): fastest route + least-changes route — see `docs/routing.md`
- [ ] Multi-line journeys with interchange handling
- [ ] Offline line/station timetable data packs (Delhi Metro, etc.)
- [ ] Fallback ETA-clock alarm if GPS is unreliable underground (worst-case ETA from schedule)
- [ ] "Get off!" walk-to-exit countdown (e.g., 90 seconds before the stop)
- [ ] Sound profile customization, themes
- [ ] History / favourites / recent trips

## Existing alternatives (competitive landscape — researched Oct 2026)

Generic GPS "wake me at my stop" apps already exist; none are metro-specific for India
and most rely purely on raw GPS proximity, which is weak underground:

| App | Platform | Summary |
|---|---|---|
| **Don't Miss the Stop: GPS Alarm** | Android | Real-time GPS tracking, loud alarm when near your stop. 4.2★ on Play Store. Closest generic competitor. |
| **WakeStop: Station Wake Alarm** | iOS | Wake alarm on bus/tram/train; search a stop, set a wake-up radius. |
| **Wake Me There – GPS Alarm** | Android | Free generic GPS alarm for commuters (MapFactor). |
| **WakeMeApp** | iOS/Android | Alarm clock for long-distance train journeys |
| **Bipit** | ? | Location-based transit wake-up alarm (indie launch, Reddit). |
| **MetroNap** | iOS (2013) | Historic NYC subway nap-alarm app — concept validation, appears unmaintained. |

Related-but-different: official metro apps (e.g., DMRC's app) offer route planning and
station alert features but not a dependable loud wake-up alarm; Google Maps has station
exit alerts on transit directions but no "wake me 2 stops early" alarm.

### Differentiators to aim for

1. **Station-aware, not radius-aware** — detect progress along the *line* (stop counting),
   not just "within X metres", which fails in tunnels with patchy GPS.
2. **Wired for metro (esp. Indian metros)** — official station/line data, offline.
3. **Reliable native alarm** — full-screen looping audio + vibration that survives
   Doze/battery-saver; most generic apps fail here.
4. **Alarm N stops before destination** — the exact UX the existing apps do poorly.

## Tech stack (decided)

- **React Native** (single codebase for Android + iOS)
- TypeScript
- Background location / geofencing + native alarm/notification modules as needed
- Local station/line data (JSON/SQLite) — no backend for MVP

## Environment / prerequisites (to be set up)

- Node.js LTS + npm
- React Native CLI environment (Xcode for iOS, Android SDK/emulator for Android)
- A physical device is preferred for testing GPS + background alarms (emulators fake location poorly)

## Status

🚧 **MVP in progress.** React Native 0.88 (bare) + TypeScript. Route planner, trip
alarm, native alarm path and the full-network data pack are implemented and shipped
as APKs in `apk/` (`MetroAlarm-debug.apk` for sideloading, `MetroAlarm-release.apk`).

What's built today:

- **Route planner (all Delhi Metro lines)** — fastest (Dijkstra) & least-changes
  (BFS on line graph + constrained Dijkstra), 100% on-device, offline.
- **Trip alarm (Blue Line MVP)** — declared origin/destination + GPS snap-to-station
  anchors, N-stops-before alarm with 2-confirmation window, underground ETA fallback,
  native AlarmService (looping audio + vibration + full-screen intent), snooze.
- **Auto-detect origin** — GPS fix snapped to the nearest planned station.
- **Walk-to-exit countdown** — 90 s countdown after arrival.
- **Data pack** — `src/metro/delhiNetwork.g.ts`, generated by
  `tools/data-prep/build-network.mjs` from OSM route relations; GPS anchors +
  distance-derived inter-station times.
- **UI** — dark/light theme toggle, metro-themed cards, stage timeline.

Design docs in `docs/`:

- `docs/station-detection.md` — how the app knows stops remaining (Blue Line MVP)
- `docs/routing.md` — on-device route planner: fastest & least-changes
- `docs/decisions.md` — decision log (stack, APIs, scope choices)

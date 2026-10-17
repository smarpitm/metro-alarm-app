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

### MVP
- [ ] Select origin (auto-detect) and destination station
- [ ] Choose "alarm before destination": 1 or 2 stops
- [ ] GPS-based stop detection for the chosen line
- [ ] Loud, looping alarm + vibration + full-screen notification that fires in the background
- [ ] Snooze / dismiss controls
- [ ] Offline-first (no data connection needed after line data is cached)

### Later
- [ ] Multi-line journeys with interchange handling
- [ ] Offline line/station timetable data packs (Delhi Metro, etc.)
- [ ] Fallback ETA-clock alarm if GPS is unreliable underground (worst-case ETA from schedule)
- [ ] "Get off!" walk-to-exit countdown (e.g., 90 seconds before the stop)
- [ ] Sound profile customization, themes
- [ ] History / favourites / recent trips

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

🚧 **Pre-code phase.** Repository initialised, planning docs only. No application code yet.

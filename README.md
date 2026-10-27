# Delhi Metro Alarm App 🚇⏰

> **100% Offline, Privacy-First Transit Alarm & Route Planner for the Delhi Metro**  
> Wakes you up $N$ stops before your destination or transfer interchange—even deep underground in concrete tunnels with zero GPS, cellular data, or internet.

[![Tests](https://img.shields.io/badge/tests-45%20passed-brightgreen.svg)](file:///c:/Users/Smarpit/Projects/metro-alarm-app/__tests__)
[![Platform](https://img.shields.io/badge/platform-Android-blue.svg)](file:///c:/Users/Smarpit/Projects/metro-alarm-app/android)
[![React Native](https://img.shields.io/badge/react--native-0.88-61dafb.svg)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.0-3178c6.svg)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 📸 Screenshots & Previews

<!-- Place your real device screenshots in assets/screenshots/ or link below -->

| 1. Journey Setup & Route Choices | 2. Active Underground HUD | 3. Offline Route Planner | 4. Full-Screen Alarm HUD |
| :---: | :---: | :---: | :---: |
| <img src="assets/screenshots/setup_screen.png" width="220" alt="Journey Setup & Alternate Routes" onerror="this.src='https://placehold.co/400x800/0a0d14/3875f6?text=Journey+Setup+UI';" /> | <img src="assets/screenshots/underground_hud.png" width="220" alt="Active Underground HUD" onerror="this.src='https://placehold.co/400x800/0a0d14/10b981?text=Underground+HUD';" /> | <img src="assets/screenshots/planner_screen.png" width="220" alt="Delhi Route Planner" onerror="this.src='https://placehold.co/400x800/0a0d14/f59e0b?text=Route+Planner';" /> | <img src="assets/screenshots/alarm_screen.png" width="220" alt="Lock Screen Alarm" onerror="this.src='https://placehold.co/400x800/0a0d14/ef4444?text=Alarm+Lockscreen';" /> |
| *From/To selectors, top 2 routes & alert modes* | *Stops countdown, tunnel dead-reckoning & delay hold* | *Multi-criteria Dijkstra search & quick-select hubs* | *Emergency high-volume audio & 1-tap dismissal* |

---

## ⚡ Why Metro Alarm?

Generic GPS transit apps (Google Maps, Citymapper, generic radius alarms) fail inside Indian metros:
1. **Physical GPS Occlusion**: Once inside underground tunnels (e.g. Rajiv Chowk, Kashmere Gate, Hauz Khas), GPS signal drops to zero. Generic apps freeze or ring wildly.
2. **Signal Stalls & Bottlenecks**: Trains frequently pause at signals between stations. Clock-based timers drift and sound prematurely.
3. **Android Battery Killers**: Aggressive OEM battery savers (Xiaomi MIUI, Samsung OneUI, OnePlus OxygenOS) kill background apps during 45-minute commutes.
4. **No Alternate Transfer Options**: Riders travelling across lines are forced through crowded single routes without interchange choices.

**Metro Alarm solves all of these** through layered sensor fusion, native Android foreground services, offline graph algorithms, and hardware watchdog wakeups.

---

## 🌟 Key Features

* 🚇 **100% Offline Operation**: Zero internet or cellular data required. The complete Delhi Metro network topology, transfer graph, and timetable runtimes are bundled locally ($< 120\text{ KB}$).
* 🔀 **Top 2 Alternate Routes**: Automatically calculates and presents **Route 1 (Fastest / Direct)** vs **Route 2 (Alternate Interchange)** (e.g., via Mandi House vs Rajiv Chowk) with line badges, stop counts, and duration.
* 🛡️ **Tunnel Dead-Reckoning & Accelerometer Fusion**:
  * Native 3-axis accelerometer integration (`Sensor.TYPE_ACCELEROMETER`) senses physical train movement vs platform dwell.
  * Cellular station snapping expanded to $600\text{m}$ in tunnels.
  * **`⏸ Train Stopped / Delay`**: One-tap delay hold freezes the countdown when a train halts at a tunnel signal.
  * **`⏮ Prev Stop` / `⏭ Next Stop`**: Instant manual station recalibration.
* 🔕 **Tri-Mode Alert Engine**:
  * 🔔 **Sound + Vibrate**: Emergency high-volume alarm routed through Android's physical alarm audio stream (`AudioAttributes.USAGE_ALARM`) that cuts through Do Not Disturb.
  * 📳 **Vibration Only**: Silent haptic pulse sequence for quiet coaches.
  * 🔕 **Silent Notification**: Heads-up status bar notification without audio or vibration.
* 🔕 **Guaranteed Dismissal (No Retriggering Loops)**:
  * Cancels AlarmManager watchdog intents once at destination.
  * Native 60-second `SharedPreferences` suppression guard prevents OS pending intents from re-ringing after manual dismissal.
* 🔄 **Off-Route & Wrong Direction Auto-Recovery**:
  * Detects if the rider mistakenly boards a train heading the wrong direction or on the wrong line.
  * Automatically recalculates a new offline Dijkstra route to the original destination.

---

## 📖 Complete Technical Documentation

Comprehensive architectural specifications and decision records are maintained in both Markdown (`.md`) and Microsoft Word (`.docx`) format in [`docs/`](docs/):

| Document | Markdown Format | Word Document | Description |
| :--- | :---: | :---: | :--- |
| **System Architecture** | [architecture.md](docs/architecture.md) | [architecture.docx](docs/architecture.docx) | System topology, sequence diagrams, Android foreground services, and sensor fusion. |
| **Decision Log (ADR)** | [decisions.md](docs/decisions.md) | [decisions.docx](docs/decisions.docx) | ADR records (D-001 through D-013) detailing stack, algorithm, and design rationales. |
| **Design System & UI/UX** | [design.md](docs/design.md) | [design.docx](docs/design.docx) | OLED dark palettes, official DMRC line color tokens, typography, and screen layouts. |
| **Technology Stack** | [tech-stack.md](docs/tech-stack.md) | [tech-stack.docx](docs/tech-stack.docx) | Frameworks, Android SDK services, complexity benchmarks, and Ponytail principles. |
| **Features & Code Deep-Dive** | [features.md](docs/features.md) | [features.docx](docs/features.docx) | Detailed walkthroughs with production code snippets (accelerometer vector math, graph routing). |
| **Routing Specification** | [routing.md](docs/routing.md) | [routing.docx](docs/routing.docx) | Dijkstra pathfinder, line graph BFS, and transfer penalty matrix. |
| **Station Detection** | [station-detection.md](docs/station-detection.md) | [station-detection.docx](docs/station-detection.docx) | Geofence anchoring, GPS jitter rejection, and cell-tower snapping algorithms. |

---

## 🛠️ Technology Stack

* **Frontend**: React Native 0.88+, TypeScript 5+, Vanilla CSS styling.
* **Native Android (Kotlin)**:
  * `LocationService.kt`: Foreground location service with `Sensor.TYPE_ACCELEROMETER` fusion.
  * `AlarmService.kt`: Media playback via `AudioAttributes.USAGE_ALARM`, vibration, and wake-locks.
  * `AlarmActivity.kt`: Full-screen lock screen HUD with `FLAG_SHOW_WHEN_LOCKED`.
  * `AlarmManager`: `setExactAndAllowWhileIdle()` hardware RTC wakeups.
* **Graph Engine**: Zero-dependency on-device Dijkstra & BFS shortest-path algorithms ($< 3\text{ ms}$ query latency).
* **Testing**: Jest 29+ with 45 unit, integration, and UI edge-case tests.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: $\ge 20\text{ LTS}$
* **Android SDK**: API Level 34 (Android 14) with Command-line Tools & CMake
* **Java Development Kit**: JDK 17 (Zulu or OpenJDK)

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/smarpitm/metro-alarm-app.git
   cd metro-alarm-app
   ```

2. **Install JavaScript dependencies**:
   ```bash
   npm install
   ```

3. **Run automated test suite**:
   ```bash
   npm test
   # Ran all test suites: 45 passed, 45 total
   ```

4. **Assemble the Android Debug APK**:
   ```bash
   cd android
   ./gradlew assembleDebug
   # Generated output: android/app/build/outputs/apk/debug/app-debug.apk
   ```

5. **Install on connected physical device / emulator**:
   ```bash
   npx react-native run-android
   ```

---

## 🧪 Testing & Validation

The codebase maintains 100% test pass coverage across edge cases:
```text
PASS src/metro/__tests__/planner.test.ts
PASS __tests__/TripController.test.ts
PASS __tests__/App.test.tsx

Test Suites: 3 passed, 3 total
Tests:       45 passed, 45 total
Snapshots:   0 total
Time:        3.81 s
```

Key edge cases covered:
* Station boundary underflow (`cursor === 0`) and terminus overflow clamping.
* Noisy GPS rejection ($> 80\text{m}$) vs tunnel cell-tower snap tolerance ($600\text{m}$).
* Delay hold persistence against incoming accelerometer vibration events.
* Zero-buffer stops (`bufferStops: 0`) alarm execution at terminus platform.
* Multi-leg transfer alarm dismissal independence from final destination alarms.
* Native `MetroAlarmDismissed` and `MetroMotionState` event lifecycle handling.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — free for personal and commercial commuter use.

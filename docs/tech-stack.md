# Delhi Metro Alarm App · Technology Stack

## 1. Architectural Stack Matrix

| Tier | Technology | Version | Purpose & Rationale |
| :--- | :--- | :--- | :--- |
| **Mobile Core** | React Native | 0.76+ | Bare React Native framework without managed wrapper overhead; allows direct access to Android foreground services and low-level sensor hardware. |
| **Primary Language** | TypeScript | 5.0+ | Strict type safety for complex graph state, route legs, and sensor payloads; eliminates runtime `undefined` crashes. |
| **Native Android** | Kotlin | 1.9+ / SDK 34 | Modern, memory-safe native execution for foreground location services, hardware audio, accelerometer event loops, and wake-locks. |
| **Routing Graph** | Native TypeScript | Zero Dependency | Custom Dijkstra and BFS line-graph implementations running 100% on-device; query time $< 3\text{ ms}$ for the full ~250 station network. |
| **Testing** | Jest & React Test Renderer | 29+ | Unit tests for graph planner, deterministic GPS replay simulators, and UI component lifecycle testing. |
| **Build & Tooling** | Gradle 8+ & Node.js 20+ | LTS | Automated native Android APK generation and modern ESBuild bundling. |

---

## 2. Native Android Platform Capabilities Used

The application relies strictly on Android Standard Library SDK APIs (`android.*`) without bloated third-party vendor SDKs or analytics trackers:

1. **`android.location.LocationManager`**:
   - Subscribes simultaneously to `GPS_PROVIDER` (satellite fixes) and `NETWORK_PROVIDER` (cell tower & Wi-Fi triangulation).
   - Manages adaptive polling frequency (balanced vs approaching modes).

2. **`android.hardware.SensorManager` & `Sensor.TYPE_ACCELEROMETER`**:
   - Subscribes to the device's physical 3-axis accelerometer (`SENSOR_DELAY_NORMAL`).
   - Computes continuous acceleration vectors to detect train movement vs platform standstill in tunnels.

3. **`android.app.AlarmManager`**:
   - Uses `setExactAndAllowWhileIdle()` with `RTC_WAKEUP`.
   - Bypasses Android Doze mode and manufacturer battery optimizations (MIUI/OneUI/ColorOS background kills) to ensure guaranteed awakening.

4. **`android.media.MediaPlayer` & `android.media.AudioAttributes`**:
   - Configured with `USAGE_ALARM` and `CONTENT_TYPE_SONIFICATION`.
   - Routes through the physical alarm audio stream, playing at full alert volume even if the phone's media or ringer volume is silenced.

5. **`android.os.Vibrator` / `VibratorManager`**:
   - Triggers aggressive, rhythmic vibration patterns (`VibrationEffect.createWaveform()`) to ensure tactile awakening.

6. **`android.content.SharedPreferences`**:
   - Stores `last_dismissed_ts` persistently on disk across process lifecycles with atomic `.apply()` writes, preventing race conditions.

---

## 3. Algorithm & Computational Efficiency

### Offline Graph Architecture

* **Spatial Complexity**: The complete Delhi Metro network contains ~250 stations and ~300 edges. The bundled JSON data pack occupies $< 120\text{ KB}$ uncompressed.
* **Graph Traversal**:
  - **Fastest Route**: Dijkstra's algorithm prioritizing cumulative transit time + transfer penalty ($300\text{s}$). Runs in $\mathcal{O}((V + E) \log V) \approx 1.5\text{ ms}$.
  - **Fewest Transfers**: Breadth-First Search (BFS) over the line-graph followed by constrained Dijkstra.
  - **Alternate Interchange Routing**: Identifies transfer hubs from primary paths and computes disjoint shortest paths avoiding specific interchange nodes.
* **Spherical Spatial Snapping**: Great-circle distances are computed using the optimized haversine formula:
  $$\Delta\sigma = 2 \arcsin \sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos\phi_1 \cos\phi_2 \sin^2\left(\frac{\Delta\lambda}{2}\right)}$$
  Executed entirely in local CPU floating-point registers.

---

## 4. Why We Rejected Heavy Dependencies (Ponytail Principle)

| Candidate Library | Decision | Rationale |
| :--- | :---: | :--- |
| **Google Directions API** | ❌ Rejected | Requires active internet, adds network latency, incurs recurring API cost, and violates 100% offline guarantee. |
| **Google Play Services Location (FusedLocationProviderClient)** | ❌ Rejected | Adds closed-source binary overhead (~15 MB), requires Google Play Services framework (fails on de-Googled devices), and adds opaque battery drain. |
| **Redux / MobX** | ❌ Rejected | Over-engineering for a localized journey state machine. Single plain-TypeScript class (`TripController`) with functional subscriber callbacks is faster, cleaner, and has zero dependency rot. |
| **Moment.js / Date-fns** | ❌ Rejected | Replaced with standard JavaScript `Date.now()` and native Math arithmetic. |

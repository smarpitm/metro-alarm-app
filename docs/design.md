# Delhi Metro Alarm App · Design System & UI/UX Specification

## 1. Design Philosophy

Commuting on the Delhi Metro is fast-paced, crowded, and stressful. The UI is built around three guiding principles:

1. **Zero Cognitive Friction**: Commuters should be able to arm an alarm in under 5 seconds with two taps.
2. **OLED Dark Transit Aesthetics**: The visual interface uses deep blacks (`#0a0d14`), high-contrast slate surfaces, and vibrant line tokens mirroring official DMRC transit maps.
3. **Glanceable Status**: When groggy or waking up in low light, key metrics (Stops Remaining, Next Station, Tunnel Status) must be readable from arm's length without reading small body text.

---

## 2. Design Tokens & Color Palette

### Base Theme

| Token | Hex Value | Usage |
| :--- | :--- | :--- |
| `background` | `#080b11` | Primary screen canvas (OLED power saving) |
| `surface` | `#111622` | Cards, input panels, bottom sheets |
| `surfaceElevated` | `#182030` | Active selection cards, popovers, modals |
| `border` | `#232d42` | Card borders, dividers, subtle separators |
| `text` | `#f0f4fc` | Primary headings, prominent station names |
| `textDim` | `#8292ab` | Secondary labels, line transfers, platform directions |
| `accent` | `#3875f6` | Primary action buttons, active tab indicators |
| `green` | `#10b981` | Approaching status, active tracking badge |
| `amber` | `#f59e0b` | Dwell platforms, tunnel warnings, delay hold state |
| `red` | `#ef4444` | Alarming state, emergency alerts, recovery mode |

### Official DMRC Transit Line Colors

| Line | Line Name | Hex Accent | Badge Color |
| :--- | :--- | :--- | :--- |
| `blue` | Blue Line (Main Trunk & Vaishali Branch) | `#0072bb` | Deep Royal Blue |
| `yellow` | Yellow Line (Samaypur Badli – Millenium City) | `#fdb913` | Golden Yellow |
| `red_line` | Red Line (Rithala – New Bus Adda) | `#ee1c25` | Crimson Red |
| `violet` | Violet Line (Kashmere Gate – Raja Nahar Singh)| `#8b1d7e` | Deep Violet |
| `magenta` | Magenta Line (Janakpuri W – Botanical Garden)| `#bf197e` | Vivid Magenta |
| `pink` | Pink Line (Majlis Park – Shiv Vihar Ring) | `#f4789b` | Bubblegum Pink |
| `airport` | Airport Express Line | `#f37023` | High-Speed Orange |

---

## 3. Screen Architecture & Core Views

```
┌────────────────────────────────────────────────────────┐
│                        App Header                      │
│        🚇 Delhi Metro Alarm    [Theme] [Test Ring]     │
├────────────────────────────────────────────────────────┤
│                                                        │
│                    [Active Screen]                     │
│  - SplashInputScreen (Initial state)                   │
│  - TripScreen (Active ride HUD)                        │
│  - PlannerScreen (Multi-criteria search)               │
│                                                        │
├────────────────────────────────────────────────────────┤
│                   Bottom Navigation Bar                │
│       [ 🚀 Alarm Setup ]          [ 🗺 Route Planner ] │
└────────────────────────────────────────────────────────┘
```

### 3.1. Journey Input Setup (`SplashInputScreen`)
* **Logical Input Order**:
  1. **"From: Boarded at"**: Station selector with instant GPS auto-detect button (`📍 Near Me`).
  2. **⇅ Swap Button**: One-tap bidirectional station inversion.
  3. **"To: Destination"**: Searchable picker with quick-select Metro hub chips (Rajiv Chowk, Kashmere Gate, Botanical Garden, Central Secretariat, Hauz Khas).
* **Buffer Stops Selector**: Pill toggle `[ 1 Stop Before ]` / `[ 2 Stops Before ]` / `[ At Station (0) ]`.
* **Alert Mode Selector (`AlertModeSelector`)**:
  - 🔔 **Sound + Vibrate**: Emergency high-volume alarm.
  - 📳 **Vibration Only**: Silent haptic pulse.
  - 🔕 **Silent Notification**: Discreet status bar notification.
* **Top 2 Route Choices (`RouteOptionsSelector`)**:
  - Displays **Route 1 (Fastest / Direct)** side-by-side with **Route 2 (Alternate Interchange)**.
  - Interactive selection cards highlight transfer station, line colors, travel time, and stop count.

### 3.2. Active Journey HUD (`TripScreen`)
* **Hero Display**:
  - Oversized Stops Remaining counter (e.g., `3 STOPS LEFT`).
  - Next Station Name with high-contrast destination badge.
  - Progress bar representing percentage of journey completed.
* **Underground Tunnel Card**:
  - Displays dynamic state: *Platform Dwelling*, *In Transit*, or *⚠️ Train Delayed in Tunnel*.
  - **`⏸ Train Stopped / Delay`**: Toggles delay hold, freezing timetable countdown.
  - **`🚇 Departed`**: Manual departure confirmation if timetable was idling.
  - **`⏮ Prev Stop` & `⏭ Next Stop`**: One-tap station calibration in tunnels.

### 3.3. Full-Screen Alarm Modal (`AlarmActivity.kt` / In-App Overlay)
* **High Contrast Red Pulsing Canvas**: Instantly alerts awakened passenger.
* **Large Touch Target Dismiss**: Prevents fumbling on crowded train exit gates.
* **Snooze Option**: Silences for 3 minutes and reschedules backup alert.

---

## 4. Micro-Interactions & Haptic Feedback

1. **Button Depress Feedback**: All interactive pressables implement subtle opacity transitions (`0.75` scale) with tactile haptic clicks (`HapticFeedbackConstants.VIRTUAL_KEY`).
2. **Smooth Progress Transitions**: Journey progress bar smoothly transitions via native spring physics rather than abrupt jumps.
3. **Accessibility**: All interactive elements maintain touch targets $\ge 48\times 48\text{ dp}$ with explicit accessibility labels for screen readers.

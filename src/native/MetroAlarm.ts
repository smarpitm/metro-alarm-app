import { NativeModules } from 'react-native';

/**
 * JS wrapper for the native alarm path (D-006).
 *
 * JS decides *when* the alarm fires (trip controller, D-007); the native side
 * owns the ringing (full-screen intent + looping audio + vibration), so it
 * survives Doze, screen-off, and a dead JS engine.
 */
interface MetroAlarmNative {
  /** Ask for POST_NOTIFICATIONS on Android 13+; call once before first startAlarm. */
  requestNotificationPermission(): Promise<boolean>;
  /** Fire the alarm now (looping sound + vibration + full-screen wake-up). */
  startAlarm(): Promise<boolean>;
  /** Stop the alarm service. */
  stopAlarm(): Promise<boolean>;
  isRinging(): Promise<boolean>;
  /** Runtime ACCESS_FINE_LOCATION request. */
  requestLocationPermission(): Promise<boolean>;
  /** Start the trip-tracking foreground service (GPS fixes → MetroTripLocation events). */
  startLocationUpdates(): Promise<boolean>;
  /** Stop trip tracking. */
  stopLocationUpdates(): Promise<boolean>;
  /** Update GPS polling policy ('economy' | 'balanced' | 'approaching') for battery saving. */
  setTrackingMode(mode: 'economy' | 'balanced' | 'approaching'): Promise<boolean>;
  /** Schedule exact alarm via AlarmManager as an underground ETA watchdog (D-006 P4). */
  scheduleAlarm(triggerAtMillis: number): Promise<boolean>;
  /** Cancel any pending AlarmManager scheduled alarm. */
  cancelScheduledAlarm(): Promise<boolean>;
  /** One-shot coordinate read to find nearest station at trip start. */
  getLastKnownLocation(): Promise<{ lat: number; lon: number; accuracy: number; ts: number } | null>;
  /** Save string key/value to persistent native SharedPreferences. */
  saveString(key: string, value: string): Promise<boolean>;
  /** Retrieve string key from persistent native SharedPreferences. */
  getString(key: string): Promise<string | null>;
}

const native = NativeModules.MetroAlarm as MetroAlarmNative | undefined;

// In-memory fallback for test/dev/mock environments
const fallbackStore = new Map<string, string>();

export const MetroAlarm: MetroAlarmNative =
  native ??
  new Proxy({} as MetroAlarmNative, {
    get(_, prop: string) {
      if (prop === 'saveString') {
        return (key: string, val: string) => {
          fallbackStore.set(key, val);
          return Promise.resolve(true);
        };
      }
      if (prop === 'getString') {
        return (key: string) => {
          return Promise.resolve(fallbackStore.get(key) ?? null);
        };
      }
      return () => Promise.resolve(false);
    },
  });

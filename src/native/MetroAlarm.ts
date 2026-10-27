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
  /** Fire the alarm now (sound/vibration/silent + full-screen wake-up). */
  startAlarm(mode?: 'sound' | 'vibration' | 'silent'): Promise<boolean>;
  /** Fire alarm with explicit mode ('sound' | 'vibration' | 'silent'). */
  startAlarmWithMode(mode: 'sound' | 'vibration' | 'silent'): Promise<boolean>;
  /** Set persistent alarm mode preference ('sound' | 'vibration' | 'silent'). */
  setAlarmMode(mode: 'sound' | 'vibration' | 'silent'): Promise<boolean>;
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

export const MetroAlarm: MetroAlarmNative = {
  requestNotificationPermission: () => native?.requestNotificationPermission() ?? Promise.resolve(false),
  startAlarm: (mode?: 'sound' | 'vibration' | 'silent') => {
    if (mode && native?.startAlarmWithMode) {
      return native.startAlarmWithMode(mode);
    }
    return native?.startAlarm() ?? Promise.resolve(false);
  },
  startAlarmWithMode: (mode: 'sound' | 'vibration' | 'silent') =>
    native?.startAlarmWithMode(mode) ?? Promise.resolve(false),
  setAlarmMode: (mode: 'sound' | 'vibration' | 'silent') =>
    native?.setAlarmMode(mode) ?? Promise.resolve(false),
  stopAlarm: () => native?.stopAlarm() ?? Promise.resolve(false),
  isRinging: () => native?.isRinging() ?? Promise.resolve(false),
  requestLocationPermission: () => native?.requestLocationPermission() ?? Promise.resolve(false),
  startLocationUpdates: () => native?.startLocationUpdates() ?? Promise.resolve(false),
  stopLocationUpdates: () => native?.stopLocationUpdates() ?? Promise.resolve(false),
  setTrackingMode: mode => native?.setTrackingMode(mode) ?? Promise.resolve(false),
  scheduleAlarm: triggerAtMillis => native?.scheduleAlarm(triggerAtMillis) ?? Promise.resolve(false),
  cancelScheduledAlarm: () => native?.cancelScheduledAlarm() ?? Promise.resolve(false),
  getLastKnownLocation: () => native?.getLastKnownLocation() ?? Promise.resolve(null),
  saveString: (key, value) => native?.saveString(key, value) ?? Promise.resolve(false),
  getString: key => native?.getString(key) ?? Promise.resolve(null),
};

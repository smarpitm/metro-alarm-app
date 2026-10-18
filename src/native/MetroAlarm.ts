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
}

const native = NativeModules.MetroAlarm as MetroAlarmNative | undefined;

export const MetroAlarm: MetroAlarmNative =
  native ??
  // Soft fallback for test/jest environments and early misconfiguration: methods
  // resolve false instead of crashing. Loud in dev logs, silent on-device.
  new Proxy({} as MetroAlarmNative, {
    get(_, prop: string) {
      if (!__DEV__) {
        console.warn(`MetroAlarm native module missing; call to ${prop} ignored`);
      }
      return () => Promise.resolve(false);
    },
  });

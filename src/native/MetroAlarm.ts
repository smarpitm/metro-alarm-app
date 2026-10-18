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
}

const native = NativeModules.MetroAlarm as MetroAlarmNative | undefined;

if (!native) {
  // Makes misconfiguration loud in dev instead of a silent undefined crash later.
  throw new Error(
    'Native module "MetroAlarm" not found — is MetroAlarmPackage registered in MainApplication?',
  );
}

export const MetroAlarm = native;

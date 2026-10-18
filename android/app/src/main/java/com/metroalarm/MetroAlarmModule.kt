package com.metroalarm

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Native alarm control surface for JS (D-006).
 *
 * JS only *decides* when to ring; everything that must survive a dead process
 * (looping sound, vibration, full-screen wake-up) lives in AlarmService, which
 * this module starts/stops. The trip controller (D-007) will call startAlarm()
 * at "N stops remaining"; for now JS can call it directly for testing.
 */
class MetroAlarmModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private companion object {
    const val REQUEST_CODE = 4401
  }

  override fun getName(): String = "MetroAlarm"

  /**
   * Android 13+ gates notifications behind a runtime permission.
   * JS calls this once (first trip / first test) before startAlarm.
   * Fire-and-forget: denial does not block ringing in the foreground app case.
   */
  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity != null && Build.VERSION.SDK_INT >= 33) {
      activity.requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), REQUEST_CODE)
    }
    promise.resolve(activity != null)
  }

  @ReactMethod
  fun startAlarm(promise: Promise) {
    try {
      AlarmService.start(reactContext.applicationContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ALARM_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stopAlarm(promise: Promise) {
    try {
      val context = reactContext.applicationContext
      context.startService(
        Intent(context, AlarmService::class.java).setAction(AlarmService.ACTION_STOP),
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ALARM_STOP_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun isRinging(promise: Promise) {
    promise.resolve(AlarmService.isRinging)
  }
}

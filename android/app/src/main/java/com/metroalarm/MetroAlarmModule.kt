package com.metroalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.os.Build
import com.facebook.react.bridge.Arguments
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

  companion object {
    const val REQUEST_CODE = 4401
    const val SCHEDULE_REQUEST_CODE = 4403

    /** Used by LocationService to emit events; set when the module initializes. */
    @JvmStatic
    var appContext: ReactApplicationContext? = null
  }

  init {
    appContext = reactContext
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

  /** Runtime location permission (ACCESS_FINE_LOCATION) — required before GPS. */
  @ReactMethod
  fun requestLocationPermission(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      activity.requestPermissions(
        arrayOf("android.permission.ACCESS_FINE_LOCATION"),
        REQUEST_CODE + 1,
      )
    }
    promise.resolve(activity != null)
  }

  /** Starts the trip-tracking foreground service (GPS fixes → MetroTripLocation). */
  @ReactMethod
  fun startLocationUpdates(promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val intent = Intent(context, LocationService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("LOCATION_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stopLocationUpdates(promise: Promise) {
    try {
      val context = reactContext.applicationContext
      context.startService(
        Intent(context, LocationService::class.java).setAction(LocationService.ACTION_STOP),
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("LOCATION_STOP_FAILED", e.message, e)
    }
  }

  /** Schedules an exact alarm via AlarmManager as an underground ETA watchdog (D-006 P4). */
  @ReactMethod
  fun scheduleAlarm(triggerAtMillis: Double, promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val intent = Intent(context, AlarmService::class.java)
      val pi = PendingIntent.getService(
        context,
        SCHEDULE_REQUEST_CODE,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis.toLong(), pi)
      } else {
        am.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis.toLong(), pi)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun cancelScheduledAlarm(promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val intent = Intent(context, AlarmService::class.java)
      val pi = PendingIntent.getService(
        context,
        SCHEDULE_REQUEST_CODE,
        intent,
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
      )
      if (pi != null) {
        am.cancel(pi)
        pi.cancel()
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("CANCEL_SCHEDULE_FAILED", e.message, e)
    }
  }

  /** Quick one-shot coordinate read to auto-detect the nearest station at trip start. */
  @ReactMethod
  fun getLastKnownLocation(promise: Promise) {
    try {
      val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      var bestLoc: Location? = null
      for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
        try {
          val loc = lm.getLastKnownLocation(provider)
          if (loc != null && (bestLoc == null || loc.time > bestLoc.time)) {
            bestLoc = loc
          }
        } catch (_: SecurityException) {
        }
      }
      if (bestLoc != null) {
        val map = Arguments.createMap().apply {
          putDouble("lat", bestLoc.latitude)
          putDouble("lon", bestLoc.longitude)
          putDouble("accuracy", bestLoc.accuracy.toDouble())
          putDouble("ts", bestLoc.time.toDouble())
        }
        promise.resolve(map)
      } else {
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.reject("LOCATION_FAILED", e.message, e)
    }
  }
}

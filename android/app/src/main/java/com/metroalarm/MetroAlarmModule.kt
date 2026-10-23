package com.metroalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

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

    @JvmStatic
    fun cancelWatchdogAlarm(context: Context) {
      try {
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
      } catch (_: Exception) {
      }
    }

    @JvmStatic
    fun notifyAlarmDismissed(context: Context) {
      cancelWatchdogAlarm(context)
      try {
        appContext
          ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit("MetroAlarmDismissed", null)
      } catch (_: Exception) {
      }
    }
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
  fun setAlarmMode(mode: String, promise: Promise) {
    try {
      val prefs = reactContext.getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
      prefs.edit().putString("metro_alarm_mode", mode).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SET_MODE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun startAlarmWithMode(mode: String, promise: Promise) {
    try {
      AlarmService.start(reactContext.applicationContext, mode)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ALARM_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun startAlarm(promise: Promise) {
    try {
      val prefs = reactContext.getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
      val mode = prefs.getString("metro_alarm_mode", "sound")
      AlarmService.start(reactContext.applicationContext, mode)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ALARM_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stopAlarm(promise: Promise) {
    try {
      val context = reactContext.applicationContext
      cancelWatchdogAlarm(context)
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

  /**
   * Adaptive GPS polling policy for battery optimization:
   * 'economy'     -> 8000ms, 35m (cruising between distant stations)
   * 'approaching' -> 2000ms, 12m (approaching destination or transfer station)
   * 'balanced'    -> 4000ms, 20m (default riding)
   */
  @ReactMethod
  fun setTrackingMode(mode: String, promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val intent = Intent(context, LocationService::class.java).apply {
        action = LocationService.ACTION_UPDATE_POLICY
        when (mode) {
          "economy" -> {
            putExtra(LocationService.EXTRA_MIN_TIME, 8000L)
            putExtra(LocationService.EXTRA_MIN_DISTANCE, 35f)
          }
          "approaching" -> {
            putExtra(LocationService.EXTRA_MIN_TIME, 2000L)
            putExtra(LocationService.EXTRA_MIN_DISTANCE, 12f)
          }
          else -> {
            putExtra(LocationService.EXTRA_MIN_TIME, 4000L)
            putExtra(LocationService.EXTRA_MIN_DISTANCE, 20f)
          }
        }
      }
      context.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SET_POLICY_FAILED", e.message, e)
    }
  }

  /** Schedules an exact alarm via AlarmManager as an underground ETA watchdog (D-006 P4). */
  @ReactMethod
  fun scheduleAlarm(triggerAtMillis: Double, promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val prefs = context.getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
      val mode = prefs.getString("metro_alarm_mode", "sound")
      val intent = Intent(context, AlarmService::class.java).apply {
        putExtra(AlarmService.EXTRA_ALARM_MODE, mode)
      }
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
      cancelWatchdogAlarm(reactContext.applicationContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("CANCEL_SCHEDULE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun saveString(key: String, value: String, promise: Promise) {
    try {
      val prefs = reactContext.getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
      prefs.edit().putString(key, value).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SAVE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun getString(key: String, promise: Promise) {
    try {
      val prefs = reactContext.getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
      promise.resolve(prefs.getString(key, null))
    } catch (e: Exception) {
      promise.reject("GET_FAILED", e.message, e)
    }
  }

  /** Quick one-shot coordinate read to auto-detect the nearest station at trip start. */
  @ReactMethod
  fun getLastKnownLocation(promise: Promise) {
    try {
      val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      var bestLoc: Location? = null
      for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)) {
        try {
          val loc = lm.getLastKnownLocation(provider)
          if (loc != null && (bestLoc == null || loc.time > bestLoc.time)) {
            bestLoc = loc
          }
        } catch (_: SecurityException) {
        }
      }

      val now = System.currentTimeMillis()
      // If we have a fresh (under 2 minutes) accurate fix, return it immediately
      if (bestLoc != null && (now - bestLoc.time < 120_000L) && bestLoc.accuracy <= 100f) {
        promise.resolve(locationToMap(bestLoc))
        return
      }

      // Otherwise request a fresh single fix with a 3.5s timeout fallback
      var resolved = false
      val handler = Handler(Looper.getMainLooper())
      var listener: LocationListener? = null

      val finish = { loc: Location? ->
        if (!resolved) {
          resolved = true
          listener?.let {
            try { lm.removeUpdates(it) } catch (_: SecurityException) {}
          }
          val finalLoc = loc ?: bestLoc
          if (finalLoc != null) {
            promise.resolve(locationToMap(finalLoc))
          } else {
            promise.resolve(null)
          }
        }
      }

      val timeoutRunnable = Runnable { finish(null) }
      handler.postDelayed(timeoutRunnable, 3500L)

      listener = object : LocationListener {
        override fun onLocationChanged(loc: Location) {
          handler.removeCallbacks(timeoutRunnable)
          finish(loc)
        }
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
      }

      var requested = false
      for (provider in listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)) {
        try {
          if (lm.isProviderEnabled(provider)) {
            lm.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
            requested = true
          }
        } catch (_: SecurityException) {}
      }

      if (!requested) {
        handler.removeCallbacks(timeoutRunnable)
        finish(null)
      }
    } catch (e: Exception) {
      promise.reject("LOCATION_FAILED", e.message, e)
    }
  }

  private fun locationToMap(loc: Location) = Arguments.createMap().apply {
    putDouble("lat", loc.latitude)
    putDouble("lon", loc.longitude)
    putDouble("accuracy", loc.accuracy.toDouble())
    putDouble("ts", loc.time.toDouble())
  }
}

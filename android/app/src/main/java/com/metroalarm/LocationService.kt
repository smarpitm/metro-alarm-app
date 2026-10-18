package com.metroalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Foreground service streaming GPS fixes to JS during an active trip (D-007 P1).
 * Schema per fix: { lat, lon, accuracy, speed, ts } → JS event "MetroTripLocation".
 * JS owns ALL decisions (snap, count, alarm); this service only observes.
 */
class LocationService : Service(), LocationListener {

  override fun onBind(intent: Intent?) = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopTracking()
      stopSelf()
      return START_NOT_STICKY
    }
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    requestUpdates()
    running = true
    return START_STICKY
  }

  private fun requestUpdates() {
    val lm = getSystemService(LOCATION_SERVICE) as LocationManager
    try {
      lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 12f, this, Looper.getMainLooper())
    } catch (_: SecurityException) {
    }
    try {
      lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 30f, this, Looper.getMainLooper())
    } catch (_: SecurityException) {
    }
  }

  override fun onLocationChanged(location: Location) {
    val ctx = MetroAlarmModule.appContext ?: return
    val params = Arguments.createMap().apply {
      putDouble("lat", location.latitude)
      putDouble("lon", location.longitude)
      putDouble("accuracy", location.accuracy.toDouble())
      putDouble("speed", location.speed.toDouble())
      putDouble("ts", location.time.toDouble())
    }
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("MetroTripLocation", params)
  }

  private fun stopTracking() {
    running = false
    val lm = getSystemService(LOCATION_SERVICE) as LocationManager
    try {
      lm.removeUpdates(this)
    } catch (_: SecurityException) {
    }
    MetroAlarmModule.appContext?.notificationManager?.cancel(NOTIFICATION_ID)
  }

  private fun buildNotification(): Notification {
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(
          TRIP_CHANNEL_ID,
          "Metro trip",
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, TRIP_CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("Metro trip active")
      .setContentText("Tracking your ride so the alarm fires on time")
      // ponytail: stock platform icon until we brand the app
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setOngoing(true)
      .build()
  }

  companion object {
    const val ACTION_STOP = "com.metroalarm.STOP_LOCATION"

    private const val TRIP_CHANNEL_ID = "metro_trip"
    private const val NOTIFICATION_ID = 2

    @JvmStatic
    var running: Boolean = false
      private set
  }
}

// Small helper extension contextual to module (notification access without leaks).
internal val ReactApplicationContext.notificationManager: android.app.NotificationManager
  get() = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager

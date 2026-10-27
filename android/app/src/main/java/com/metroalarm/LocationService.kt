package com.metroalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
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
 * Schema per fix: { lat, lon, accuracy, speed, ts, moving } → JS event "MetroTripLocation".
 * Also emits "MetroMotionState" for dead-reckoning pause when stationary underground.
 * JS owns ALL decisions (snap, count, alarm); this service only observes.
 */
class LocationService : Service(), LocationListener, SensorEventListener {

  private var currentMinTime: Long = 4000L
  private var currentMinDistance: Float = 20f
  private var lastMotionTime: Long = System.currentTimeMillis()
  private var lastReportedMoving: Boolean = true
  private var sensorManager: SensorManager? = null

  override fun onBind(intent: Intent?) = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopTracking()
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent?.action == ACTION_UPDATE_POLICY) {
      val minTime = intent.getLongExtra(EXTRA_MIN_TIME, currentMinTime)
      val minDistance = intent.getFloatExtra(EXTRA_MIN_DISTANCE, currentMinDistance)
      applyPolicy(minTime, minDistance)
      return START_STICKY
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
    applyPolicy(currentMinTime, currentMinDistance)
    if (sensorManager == null) {
      val sm = getSystemService(SENSOR_SERVICE) as? SensorManager
      sensorManager = sm
      val accel = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      if (accel != null) {
        sm.registerListener(this, accel, SensorManager.SENSOR_DELAY_NORMAL)
      }
    }
    running = true
    return START_STICKY
  }

  private fun applyPolicy(minTime: Long, minDistance: Float) {
    currentMinTime = minTime
    currentMinDistance = minDistance
    val lm = getSystemService(LOCATION_SERVICE) as LocationManager
    try {
      lm.removeUpdates(this)
    } catch (_: SecurityException) {
    }
    try {
      lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, minTime, minDistance, this, Looper.getMainLooper())
    } catch (_: SecurityException) {
    }
    try {
      val netTime = (minTime * 1.5).toLong().coerceAtLeast(3000L)
      val netDist = (minDistance * 1.5f).coerceAtLeast(25f)
      lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, netTime, netDist, this, Looper.getMainLooper())
    } catch (_: SecurityException) {
    }
  }

  override fun onSensorChanged(event: SensorEvent?) {
    if (event?.sensor?.type == Sensor.TYPE_ACCELEROMETER) {
      val x = event.values[0]
      val y = event.values[1]
      val z = event.values[2]
      val mag = Math.sqrt((x * x + y * y + z * z).toDouble()).toFloat()
      val diff = Math.abs(mag - 9.8f)
      val now = System.currentTimeMillis()

      if (diff > 0.35f) {
        lastMotionTime = now
      }

      val moving = (now - lastMotionTime < 6000L)
      if (moving != lastReportedMoving) {
        lastReportedMoving = moving
        val ctx = MetroAlarmModule.appContext ?: return
        val params = Arguments.createMap().apply {
          putBoolean("moving", moving)
        }
        try {
          ctx
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("MetroMotionState", params)
        } catch (_: Exception) {}
      }
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

  override fun onLocationChanged(location: Location) {
    val ctx = MetroAlarmModule.appContext ?: return
    val params = Arguments.createMap().apply {
      putDouble("lat", location.latitude)
      putDouble("lon", location.longitude)
      putDouble("accuracy", location.accuracy.toDouble())
      putDouble("speed", location.speed.toDouble())
      putDouble("ts", location.time.toDouble())
      putBoolean("moving", lastReportedMoving)
    }
    ctx
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("MetroTripLocation", params)
  }

  private fun stopTracking() {
    running = false
    try {
      sensorManager?.unregisterListener(this)
    } catch (_: Exception) {}
    sensorManager = null
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
    const val ACTION_UPDATE_POLICY = "com.metroalarm.UPDATE_POLICY"
    const val EXTRA_MIN_TIME = "min_time"
    const val EXTRA_MIN_DISTANCE = "min_distance"

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

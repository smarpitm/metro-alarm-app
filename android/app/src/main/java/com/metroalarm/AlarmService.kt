package com.metroalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * The native alarm path (D-006): owns everything that must survive Doze, screen
 * off, and a backgrounded/JS-dead process:
 *  - looping alarm audio (MediaPlayer, USAGE_ALARM, default system alarm tone),
 *  - repeating vibration,
 *  - a notification whose full-screen intent launches AlarmActivity (over lock screen).
 *
 * Started by MetroAlarmModule.startAlarm(); stopped via ACTION_STOP
 * (from AlarmActivity's dismiss button or JS stopAlarm()).
 */
class AlarmService : Service() {

  private var player: MediaPlayer? = null
  private var currentMode: String = "sound"

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopRinging()
      stopSelf()
      return START_NOT_STICKY
    }

    // Check if dismissed within the last 60 seconds to prevent stray watchdog re-triggering
    val prefs = getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
    val lastDismissed = prefs.getLong("last_dismissed_ts", 0L)
    if (System.currentTimeMillis() - lastDismissed < 60_000L) {
      stopSelf()
      return START_NOT_STICKY
    }

    currentMode = intent?.getStringExtra(EXTRA_ALARM_MODE)
      ?: prefs.getString("metro_alarm_mode", "sound")
      ?: "sound"

    startRinging(currentMode)
    val notification = buildNotification(currentMode)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification,
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  private fun startRinging(mode: String) {
    if (player?.isPlaying == true) return
    isRinging = true

    // Sound: default system alarm tone, looping, on the alarm stream (overrides media volume)
    // Only played if mode is 'sound'
    if (mode == "sound") {
      try {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
          ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val p = MediaPlayer()
        player = p
        p.setDataSource(this, uri)
        p.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        p.isLooping = true
        p.prepare()
        p.start()
      } catch (e: Exception) {
        // No usable alarm tone — fallback
        player = null
      }
    }

    // Vibration: repeating pump-pause pattern (sound & vibration modes)
    if (mode == "sound" || mode == "vibration") {
      try {
        val vib = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 800, 800)
        vib.vibrate(VibrationEffect.createWaveform(pattern, 0))
      } catch (_: Exception) {
      }
    } else if (mode == "silent") {
      // In silent mode: single gentle tap haptic on start, no continuous loud buzzer
      try {
        val vib = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vib.vibrate(VibrationEffect.createOneShot(150, VibrationEffect.DEFAULT_AMPLITUDE))
        }
      } catch (_: Exception) {
      }
    }
  }

  private fun stopRinging() {
    isRinging = false
    try {
      player?.stop()
      player?.release()
    } catch (_: Exception) {
    }
    player = null
    try {
      val vib = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(VIBRATOR_SERVICE) as Vibrator
      }
      vib.cancel()
    } catch (_: Exception) {
    }
  }

  private fun buildNotification(mode: String): Notification {
    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    val channelId = if (mode == "silent") CHANNEL_ID_SILENT else CHANNEL_ID

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      if (mode == "silent") {
        val silentChannel = NotificationChannel(
          CHANNEL_ID_SILENT,
          "Metro alarm (Silent)",
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          setSound(null, null)
          enableVibration(false)
        }
        notificationManager.createNotificationChannel(silentChannel)
      } else {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Metro alarm",
          NotificationManager.IMPORTANCE_HIGH,
        )
        channel.enableVibration(true)
        notificationManager.createNotificationChannel(channel)
      }
    }

    // Full-screen intent: launches AlarmActivity even when the screen is locked.
    val activityIntent = Intent(this, AlarmActivity::class.java)
      .putExtra(EXTRA_ALARM_MODE, mode)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val fullScreenIntent = PendingIntent.getActivity(
      this,
      0,
      activityIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
    } else {
      Notification.Builder(this)
    }

    val subtitle = when (mode) {
      "silent" -> "Silent alert: Time to get ready to get off!"
      "vibration" -> "Vibration alert: Time to get ready to get off!"
      else -> "Time to get ready to get off!"
    }

    builder
      .setContentTitle("Metro alarm")
      .setContentText(subtitle)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setPriority(Notification.PRIORITY_MAX)
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setFullScreenIntent(fullScreenIntent, true)
      .setContentIntent(fullScreenIntent)

    return builder.build()
  }

  override fun onDestroy() {
    stopRinging()
    super.onDestroy()
  }

  companion object {
    const val ACTION_STOP = "com.metroalarm.STOP_ALARM"
    const val EXTRA_ALARM_MODE = "alarm_mode"

    private const val CHANNEL_ID = "metro_alarm"
    private const val CHANNEL_ID_SILENT = "metro_alarm_silent"
    private const val NOTIFICATION_ID = 1

    /** Static so JS-side isRinging works without binding to the service. */
    @JvmStatic
    var isRinging: Boolean = false
      private set

    fun start(context: Context, mode: String? = null) {
      val intent = Intent(context, AlarmService::class.java).apply {
        if (mode != null) {
          putExtra(EXTRA_ALARM_MODE, mode)
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }
}

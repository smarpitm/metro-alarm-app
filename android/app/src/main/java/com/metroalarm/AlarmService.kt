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

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopRinging()
      stopSelf()
      return START_NOT_STICKY
    }

    startRinging()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification,
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  private fun startRinging() {
    if (player?.isPlaying == true) return
    isRinging = true

    // Sound: default system alarm tone, looping, on the alarm stream (overrides media volume)
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
      // No usable alarm tone — vibration alone still wakes the rider up.
      player = null
    }

    // Vibration: repeating pump-pause pattern, coarse so Doze can't throttle audio to silence
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

  private fun buildNotification(): Notification {
    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Metro alarm",
        NotificationManager.IMPORTANCE_HIGH,
      )
      channel.enableVibration(true)
      notificationManager.createNotificationChannel(channel)
    }

    // Full-screen intent: launches AlarmActivity even when the screen is locked.
    val activityIntent = Intent(this, AlarmActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val fullScreenIntent = PendingIntent.getActivity(
      this,
      0,
      activityIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    builder
      .setContentTitle("Metro alarm")
      .setContentText("Time to get ready to get off!")
      // ponytail: stock platform icon; swap for a real asset when we brand the app
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setPriority(Notification.PRIORITY_MAX)
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setFullScreenIntent(fullScreenIntent, true)

    // Expandable fallback: tap the notification itself if the full-screen launch was denied.
    builder.setContentIntent(fullScreenIntent)

    return builder.build()
  }

  override fun onDestroy() {
    stopRinging()
    super.onDestroy()
  }

  companion object {
    const val ACTION_STOP = "com.metroalarm.STOP_ALARM"

    private const val CHANNEL_ID = "metro_alarm"
    private const val NOTIFICATION_ID = 1

    /** Static so JS-side isRinging works without binding to the service. */
    @JvmStatic
    var isRinging: Boolean = false
      private set

    fun start(context: Context) {
      val intent = Intent(context, AlarmService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }
}

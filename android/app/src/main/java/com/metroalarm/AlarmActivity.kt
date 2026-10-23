package com.metroalarm

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Full-screen wake-up UI shown by the alarm (D-006). Launched via the service's
 * full-screen intent, so it appears over the lock screen with the screen turned on.
 * Deliberately plain programmatic views — this screen must render instantly and
 * never depend on the React pipeline being alive.
 */
class AlarmActivity : android.app.Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Show over the lock screen and turn the screen on (API 27+ flags).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val pad = (resources.displayMetrics.density * 24).toInt()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(0xFF1B1B1B.toInt())
      setPadding(pad, pad, pad, pad)
    }

    val title = TextView(this).apply {
      text = "🚇 Get off!"
      textSize = 34f
      setTextColor(0xFFFFFFFF.toInt())
      gravity = Gravity.CENTER
    }

    val mode = intent.getStringExtra(AlarmService.EXTRA_ALARM_MODE)
    val modeText = when (mode) {
      "silent" -> " (Silent Mode)"
      "vibration" -> " (Vibration Only)"
      else -> ""
    }

    val subtitle = TextView(this).apply {
      text = "Your metro stop is coming up$modeText"
      textSize = 16f
      setTextColor(0xFFAAAAAA.toInt())
      gravity = Gravity.CENTER
      setPadding(0, pad / 2, 0, pad * 2)
    }

    val snoozeButton = Button(this).apply {
      text = "Snooze (3 min)"
      setOnClickListener { snoozeAlarm() }
    }

    val stopButton = Button(this).apply {
      text = "Dismiss"
      setOnClickListener { dismissAlarm() }
    }

    root.addView(title)
    root.addView(subtitle)
    root.addView(
      snoozeButton,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ),
    )
    val spacer = View(this).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        (resources.displayMetrics.density * 12).toInt(),
      )
    }
    root.addView(spacer)
    root.addView(
      stopButton,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ),
    )
    setContentView(root)
  }

  private fun snoozeAlarm() {
    startService(
      Intent(this, AlarmService::class.java).setAction(AlarmService.ACTION_STOP),
    )
    try {
      val am = getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
      val intent = Intent(this, AlarmService::class.java)
      val pi = android.app.PendingIntent.getService(
        this,
        MetroAlarmModule.SCHEDULE_REQUEST_CODE,
        intent,
        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
      )
      val triggerAt = System.currentTimeMillis() + 180_000L
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
      } else {
        am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
      }
    } catch (_: Exception) {
    }
    finish()
  }

  private fun dismissAlarm() {
    // 1. Mark dismiss timestamp in shared preferences to prevent stray watchdog retrigger
    try {
      getSharedPreferences("metro_alarm_prefs", Context.MODE_PRIVATE)
        .edit()
        .putLong("last_dismissed_ts", System.currentTimeMillis())
        .apply()
    } catch (_: Exception) {}

    // 2. Notify module to cancel AlarmManager watchdog and notify JS
    MetroAlarmModule.notifyAlarmDismissed(this)

    // 3. Stop running AlarmService
    startService(
      Intent(this, AlarmService::class.java).setAction(AlarmService.ACTION_STOP),
    )
    finish()
  }

  /** Back button / gesture does not dismiss the alarm silently. */
  override fun onBackPressed() {
    // ponytail: force an explicit dismiss tap; the back gesture must not mute the alarm
  }
}

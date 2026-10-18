package com.metroalarm

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

    val subtitle = TextView(this).apply {
      text = "Your metro stop is coming up"
      textSize = 16f
      setTextColor(0xFFAAAAAA.toInt())
      gravity = Gravity.CENTER
      setPadding(0, pad / 2, 0, pad * 2)
    }

    val stopButton = Button(this).apply {
      text = "Dismiss"
      setOnClickListener { dismissAlarm() }
    }

    root.addView(title)
    root.addView(subtitle)
    root.addView(
      stopButton,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ),
    )
    setContentView(root)
  }

  private fun dismissAlarm() {
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

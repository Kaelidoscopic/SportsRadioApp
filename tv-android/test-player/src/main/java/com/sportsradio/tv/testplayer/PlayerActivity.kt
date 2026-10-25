package com.sportsradio.tv.testplayer

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class PlayerActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 32, 48, 32) }
        column.addView(TextView(this).apply { textSize = 24f; text = "Separate playback control app\nStart TV capture first, then play here. Return Home to the capture app to inspect levels. Tone keeps playing until Stop. Use comfortable TV volume." })
        for ((title, action) in listOf("Play eligible tone" to "allowed", "Play capture-blocked tone" to "blocked", "Stop playback" to "stop")) {
            column.addView(Button(this).apply {
                text = title
                setOnClickListener {
                    val intent = Intent(this@PlayerActivity, PlayerService::class.java).setAction(action)
                    if (action == "stop") stopService(intent) else startForegroundService(intent)
                }
            })
        }
        setContentView(column); column.getChildAt(1).requestFocus()
    }
}

package com.omsuite.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.omsuite.android.data.ThemeChoice
import com.omsuite.android.ui.screens.OmSuiteNav
import com.omsuite.android.ui.theme.OmSuiteTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as OmSuiteApp
        setContent {
            val theme by app.settings.theme.collectAsState(initial = ThemeChoice.SYSTEM)
            OmSuiteTheme(choice = theme) {
                OmSuiteNav(app = app)
            }
        }
    }
}

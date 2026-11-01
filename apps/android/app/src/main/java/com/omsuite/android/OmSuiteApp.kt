package com.omsuite.android

import android.app.Application
import androidx.room.Room
import com.omsuite.android.data.AppDatabase
import com.omsuite.android.data.FileRepository
import com.omsuite.android.data.SettingsStore

class OmSuiteApp : Application() {
    lateinit var db: AppDatabase
        private set
    lateinit var settings: SettingsStore
        private set
    lateinit var files: FileRepository
        private set

    override fun onCreate() {
        super.onCreate()
        db = Room.databaseBuilder(this, AppDatabase::class.java, "omsuite.db")
            .fallbackToDestructiveMigration()
            .build()
        settings = SettingsStore(this)
        files = FileRepository(this)
    }
}

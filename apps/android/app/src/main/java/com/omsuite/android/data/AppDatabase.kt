package com.omsuite.android.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

/** One row per file the user actually opened/saved in OmSuite. Never seeded. */
@Entity(tableName = "recent_files")
data class RecentFile(
    @PrimaryKey val uri: String,
    val name: String,
    val lastOpened: Long,
    val size: Long = 0L
)

@Entity(tableName = "favourites")
data class Favourite(
    @PrimaryKey val uri: String,
    val name: String,
    val addedAt: Long
)

/** Autosave/recovery draft for the text editor. One draft per document URI. */
@Entity(tableName = "editor_drafts")
data class EditorDraft(
    @PrimaryKey val uri: String,
    val name: String,
    val content: String,
    val updatedAt: Long
)

@Entity(tableName = "granted_folders")
data class GrantedFolder(
    @PrimaryKey val uri: String,
    val name: String,
    val grantedAt: Long
)

@Dao
interface RecentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: RecentFile)

    @Query("SELECT * FROM recent_files ORDER BY lastOpened DESC LIMIT 50")
    fun observeAll(): Flow<List<RecentFile>>

    @Query("DELETE FROM recent_files")
    suspend fun clearAll()
}

@Dao
interface FavouriteDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun add(item: Favourite)

    @Query("DELETE FROM favourites WHERE uri = :uri")
    suspend fun remove(uri: String)

    @Query("SELECT * FROM favourites ORDER BY addedAt DESC")
    fun observeAll(): Flow<List<Favourite>>

    @Query("SELECT EXISTS(SELECT 1 FROM favourites WHERE uri = :uri)")
    suspend fun exists(uri: String): Boolean
}

@Dao
interface DraftDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(draft: EditorDraft)

    @Query("SELECT * FROM editor_drafts WHERE uri = :uri")
    suspend fun get(uri: String): EditorDraft?

    @Query("DELETE FROM editor_drafts WHERE uri = :uri")
    suspend fun delete(uri: String)
}

@Dao
interface FolderDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun add(folder: GrantedFolder)

    @Query("SELECT * FROM granted_folders ORDER BY grantedAt DESC")
    fun observeAll(): Flow<List<GrantedFolder>>

    @Query("DELETE FROM granted_folders WHERE uri = :uri")
    suspend fun remove(uri: String)
}

@Database(
    entities = [RecentFile::class, Favourite::class, EditorDraft::class, GrantedFolder::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun recentDao(): RecentDao
    abstract fun favouriteDao(): FavouriteDao
    abstract fun draftDao(): DraftDao
    abstract fun folderDao(): FolderDao
}

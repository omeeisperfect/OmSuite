package com.omsuite.android.ui.screens

import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.delay

private enum class MediaKind { IMAGE, AUDIO, VIDEO }

/**
 * Media browser over SAF picks. Images decode with BitmapFactory (no Coil),
 * audio plays with MediaPlayer, video with VideoView. Nothing is copied to
 * the cloud; playback is from the picked Uri on this device.
 */
@Composable
fun MediaScreen() {
    val context = LocalContext.current
    var mediaUri by remember { mutableStateOf<Uri?>(null) }
    var mediaName by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf<MediaKind?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    // Audio state (MediaPlayer holder survives recomposition; released on dispose/unpick).
    val playerHolder = remember { arrayOf<MediaPlayer?>(null) }
    var videoView by remember { mutableStateOf<VideoView?>(null) }
    var audioPlaying by remember { mutableStateOf(false) }
    var audioPos by remember { mutableStateOf(0) }
    var audioDur by remember { mutableStateOf(0) }
    var audioSpeed by remember { mutableStateOf(1.0f) }
    var audioQueue by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var queueIndex by remember { mutableStateOf(0) }
    var imageScale by remember { mutableStateOf(1.0f) }
    var imageRotation by remember { mutableStateOf(0f) }
    var videoFullscreen by remember { mutableStateOf(false) }
    var videoPos by remember { mutableStateOf(0) }
    var videoDur by remember { mutableStateOf(0) }
    var videoPlaying by remember { mutableStateOf(false) }

    fun releasePlayer() {
        try { playerHolder[0]?.stop() } catch (e: Exception) { /* not started */ }
        try { playerHolder[0]?.release() } catch (e: Exception) { /* already released */ }
        playerHolder[0] = null
        audioPlaying = false; audioPos = 0; audioDur = 0
    }

    DisposableEffect(Unit) { onDispose { releasePlayer() } }

    // Poll video position while playing (so the seek slider stays current).
    LaunchedEffect(videoPlaying) {
        while (videoPlaying) {
            try {
                val view = videoView
                if (view != null) {
                    videoPos = view.currentPosition
                    videoDur = view.duration.coerceAtLeast(0)
                    if (!view.isPlaying) videoPlaying = false
                }
            } catch (e: Exception) { videoPlaying = false }
            delay(500)
        }
    }

    // Poll audio position while playing.
    LaunchedEffect(audioPlaying) {
        while (audioPlaying) {
            try {
                val p = playerHolder[0]
                if (p != null) {
                    audioPos = p.currentPosition
                    audioDur = p.duration.coerceAtLeast(0)
                    if (!p.isPlaying) audioPlaying = false
                }
            } catch (e: Exception) { audioPlaying = false }
            delay(500)
        }
    }

    fun loadAudio(uri: Uri) {
        try {
            val player = MediaPlayer()
            player.setDataSource(context, uri)
            player.prepare()
            try {
                player.playbackParams = player.playbackParams.setSpeed(audioSpeed)
            } catch (e: Exception) {
                // Speed not supported for this file; playback still works at 1x.
            }
            player.setOnCompletionListener {
                audioPlaying = false
                // Advance through the queue automatically.
                if (queueIndex + 1 < audioQueue.size) {
                    val next = audioQueue[queueIndex + 1]
                    queueIndex++
                    mediaUri = next
                    mediaName = DocumentFile.fromSingleUri(context, next)?.name ?: "media"
                    releasePlayer()
                    loadAudio(next)
                    try {
                        playerHolder[0]?.start()
                        audioPlaying = true
                    } catch (e: Exception) { /* ignore */ }
                }
            }
            playerHolder[0] = player
            audioDur = player.duration.coerceAtLeast(0)
            audioPos = 0
        } catch (e: Exception) {
            error = "Could not load audio: ${e.message}"
        }
    }

    fun pick(uri: Uri, pickedKind: MediaKind) {
        releasePlayer()
        mediaUri = uri
        kind = pickedKind
        mediaName = DocumentFile.fromSingleUri(context, uri)?.name ?: "media"
        error = null
        if (pickedKind == MediaKind.AUDIO) {
            loadAudio(uri)
        }
    }


    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) pick(uri, MediaKind.IMAGE)
    }
    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            audioQueue = emptyList()
            queueIndex = 0
            pick(uri, MediaKind.AUDIO)
        }
    }
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) pick(uri, MediaKind.VIDEO)
    }
    val audioQueuePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            audioQueue = uris
            queueIndex = 0
            pick(uris.first(), MediaKind.AUDIO)
        }
    }

    if (videoFullscreen && kind == MediaKind.VIDEO && mediaUri != null) {
        val uri = mediaUri!!
        Column(Modifier.fillMaxSize()) {
            AndroidView(
                factory = { ctx ->
                    VideoView(ctx).also { view ->
                        view.setVideoURI(uri)
                        videoView = view
                        view.start()
                    }
                },
                modifier = Modifier.weight(1f)
            )
            Row(Modifier.padding(8.dp)) {
                Button(onClick = { videoView?.start() }) { Text("Play") }
                OutlinedButton(onClick = { videoView?.pause() }, modifier = Modifier.padding(start = 4.dp)) { Text("Pause") }
                OutlinedButton(onClick = { videoFullscreen = false }, modifier = Modifier.padding(start = 4.dp)) { Text("Exit fullscreen") }
            }
            DisposableEffect(uri) {
                onDispose { try { videoView?.stopPlayback() } catch (e: Exception) { /* ignore */ } }
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Text("Media", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Pick an image, audio or video file on this device. Playback stays on-device; nothing is uploaded.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = { imagePicker.launch(arrayOf("image/*")) }) { Text("Image") }
            OutlinedButton(onClick = { audioPicker.launch(arrayOf("audio/*")) }, modifier = Modifier.padding(start = 4.dp)) { Text("Audio") }
            OutlinedButton(onClick = { audioQueuePicker.launch(arrayOf("audio/*")) }, modifier = Modifier.padding(start = 4.dp)) { Text("Audio queue…") }
            OutlinedButton(onClick = { videoPicker.launch(arrayOf("video/*")) }, modifier = Modifier.padding(start = 4.dp)) { Text("Video") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        val uri = mediaUri
        if (uri == null) {
            Text("No media picked yet.", modifier = Modifier.padding(top = 16.dp))
            return@Column
        }
        Text(mediaName, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
        when (kind) {
            MediaKind.IMAGE -> {
                val bitmap = remember(uri) {
                    try {
                        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                    } catch (e: Exception) { null }
                }
                if (bitmap == null) Text("Could not decode this image.", color = MaterialTheme.colorScheme.error)
                else {
                    Row(Modifier.padding(top = 4.dp)) {
                        OutlinedButton(onClick = { imageRotation = (imageRotation + 90f) % 360f }) { Text("Rotate ↻") }
                        OutlinedButton(onClick = { imageScale = 1.0f; imageRotation = 0f }, modifier = Modifier.padding(start = 4.dp)) { Text("Reset view") }
                    }
                    Text("Zoom: ${"%.1f".format(imageScale)}× (drag the slider; rotation is on-screen only)", style = MaterialTheme.typography.bodySmall)
                    Slider(
                        value = imageScale,
                        onValueChange = { imageScale = it },
                        valueRange = 0.5f..4f,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Image(
                        bitmap.asImageBitmap(), mediaName,
                        Modifier.fillMaxWidth().padding(top = 8.dp)
                            .graphicsLayer { scaleX = imageScale; scaleY = imageScale; rotationZ = imageRotation }
                    )
                }
            }
            MediaKind.AUDIO -> {
                if (audioQueue.isNotEmpty()) {
                    Text(
                        "Queue: track ${queueIndex + 1} of ${audioQueue.size}",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
                    )
                    Row(Modifier.padding(top = 4.dp)) {
                        OutlinedButton(
                            onClick = {
                                if (queueIndex > 0) {
                                    queueIndex--
                                    pick(audioQueue[queueIndex], MediaKind.AUDIO)
                                }
                            },
                            enabled = queueIndex > 0
                        ) { Text("← Prev track") }
                        OutlinedButton(
                            onClick = {
                                if (queueIndex + 1 < audioQueue.size) {
                                    queueIndex++
                                    pick(audioQueue[queueIndex], MediaKind.AUDIO)
                                }
                            },
                            enabled = queueIndex + 1 < audioQueue.size,
                            modifier = Modifier.padding(start = 4.dp)
                        ) { Text("Next track →") }
                    }
                }
                Text("Playback speed:", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                Row {
                    listOf(0.5f, 1.0f, 1.5f, 2.0f).forEach { speed ->
                        OutlinedButton(
                            onClick = {
                                audioSpeed = speed
                                try {
                                    playerHolder[0]?.let { it.playbackParams = it.playbackParams.setSpeed(speed) }
                                } catch (e: Exception) {
                                    error = "This file does not support speed change."
                                }
                            },
                            modifier = Modifier.padding(end = 4.dp)
                        ) { Text(if (audioSpeed == speed) "● ${speed}×" else "${speed}×") }
                    }
                }
                Text(if (audioPlaying) "Playing…" else "Paused", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
                Row(Modifier.padding(top = 4.dp)) {
                    Button(onClick = {
                        try {
                            playerHolder[0]?.start()
                            audioPlaying = true
                        } catch (e: Exception) { error = "Playback failed: ${e.message}" }
                    }) { Text(if (audioPlaying) "Playing" else "Play") }
                    OutlinedButton(
                        onClick = {
                            try { playerHolder[0]?.pause() } catch (e: Exception) { /* ignore */ }
                            audioPlaying = false
                        },
                        modifier = Modifier.padding(start = 4.dp)
                    ) { Text("Pause") }
                }
                if (audioDur > 0) {
                    Slider(
                        value = audioPos.toFloat(),
                        onValueChange = { next ->
                            try { playerHolder[0]?.seekTo(next.toInt()) } catch (e: Exception) { /* ignore */ }
                            audioPos = next.toInt()
                        },
                        valueRange = 0f..audioDur.toFloat(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text(
                        "${audioPos / 1000}s / ${audioDur / 1000}s",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            MediaKind.VIDEO -> {
                AndroidView(
                    factory = { ctx ->
                        VideoView(ctx).also { view ->
                            view.setVideoURI(uri)
                            videoView = view
                            view.setOnPreparedListener { mp ->
                                videoDur = mp.duration.coerceAtLeast(0)
                                videoPos = 0
                            }
                            view.setOnCompletionListener { videoPlaying = false }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    update = { view ->
                        try {
                            videoPos = view.currentPosition
                            videoDur = view.duration.coerceAtLeast(0)
                            videoPlaying = view.isPlaying
                        } catch (e: Exception) { /* not ready */ }
                    }
                )
                Row(Modifier.padding(top = 4.dp)) {
                    Button(onClick = { videoView?.start(); videoPlaying = true }) { Text("Play") }
                    OutlinedButton(onClick = { videoView?.pause(); videoPlaying = false }, modifier = Modifier.padding(start = 4.dp)) { Text("Pause") }
                    OutlinedButton(onClick = { videoView?.seekTo(0) }, modifier = Modifier.padding(start = 4.dp)) { Text("Restart") }
                    OutlinedButton(onClick = { videoFullscreen = true }, modifier = Modifier.padding(start = 4.dp)) { Text("Fullscreen") }
                }
                if (videoDur > 0) {
                    Slider(
                        value = videoPos.toFloat(),
                        onValueChange = { next ->
                            try { videoView?.seekTo(next.toInt()) } catch (e: Exception) { /* ignore */ }
                            videoPos = next.toInt()
                        },
                        valueRange = 0f..videoDur.toFloat(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("${videoPos / 1000}s / ${videoDur / 1000}s", style = MaterialTheme.typography.bodySmall)
                }
                Text(
                    "Subtitles: not selectable here — Android's VideoView does not expose subtitle track " +
                        "selection, so no subtitle control is offered rather than a fake one. " +
                        "Use a video with burned-in subtitles, or open it in a dedicated player app.",
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
                )
                DisposableEffect(uri) {
                    onDispose { try { videoView?.stopPlayback() } catch (e: Exception) { /* ignore */ } }
                }
            }
            null -> Unit
        }
    }
}

import java.security.MessageDigest
import java.io.ByteArrayOutputStream
import java.util.zip.*

plugins { id("com.android.application") }

android {
    namespace = "com.sportsradio.tv"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.sportsradio.tv.capture"
        minSdk = 29
        targetSdk = 36
        versionCode = 4
        versionName = "0.3.1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    testImplementation("junit:junit:4.13.2")
    implementation("io.socket:socket.io-client:2.1.2") { exclude(group = "org.json", module = "json") }
    testImplementation("org.json:json:20240303")
}

// Custom ADM recording endpoint: retain the pinned native SDK and all other Java APIs,
// replacing only its microphone recorder with our playback-PCM implementation.
val upstreamWebRtc by configurations.creating { isTransitive = false }
dependencies { upstreamWebRtc("io.getstream:stream-webrtc-android:1.3.10@aar") }
val playbackWebRtc = layout.buildDirectory.file("playback-webrtc/stream-webrtc-android-1.3.10.aar")
val preparePlaybackWebRtc by tasks.registering {
    inputs.files(upstreamWebRtc); outputs.file(playbackWebRtc)
    doLast {
        val original = upstreamWebRtc.singleFile
        val digest = MessageDigest.getInstance("SHA-256").digest(original.readBytes()).joinToString("") { "%02x".format(it) }
        check(digest == "afa3b0feaa2902f6ece10e67ce3b7e6d9def18a86b73f0c6a524209cb938aa96") { "Unexpected WebRTC AAR; review JNI ABI before upgrading." }
        val target = playbackWebRtc.get().asFile; target.parentFile.mkdirs()
        ZipFile(original).use { aar ->
            ZipOutputStream(target.outputStream()).use { out ->
                for (entry in aar.entries()) {
                    out.putNextEntry(ZipEntry(entry.name))
                    if (entry.name == "classes.jar") {
                        ZipInputStream(aar.getInputStream(entry)).use { jar ->
                            val bytes = ByteArrayOutputStream()
                            ZipOutputStream(bytes).use { filtered ->
                                var item = jar.nextEntry
                                var removed = 0
                                while (item != null) {
                                    val name = item.name
                                    if (name == "org/webrtc/audio/WebRtcAudioRecord.class" || name.startsWith("org/webrtc/audio/WebRtcAudioRecord$")) removed++
                                    else { filtered.putNextEntry(ZipEntry(name)); jar.copyTo(filtered); filtered.closeEntry() }
                                    item = jar.nextEntry
                                }
                                check(removed > 0) { "Pinned SDK recorder class missing." }
                            }
                            out.write(bytes.toByteArray())
                        }
                    } else aar.getInputStream(entry).use { it.copyTo(out) }
                    out.closeEntry()
                }
            }
        }
    }
}
dependencies { implementation(files(playbackWebRtc).builtBy(preparePlaybackWebRtc)) }

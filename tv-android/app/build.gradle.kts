import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.net.URI
import java.security.MessageDigest
import java.io.ByteArrayOutputStream
import java.util.zip.*
import groovy.json.JsonSlurper

plugins { id("com.android.application") }

val stagingConfigFile = providers.gradleProperty("sportsradioStagingConfig").orNull?.let { file(it) }
    ?: rootProject.file("../config/staging.json")
val sharedStaging = JsonSlurper().parse(stagingConfigFile) as Map<*, *>
check(sharedStaging.keys == setOf("version", "backendUrl", "frontendUrl", "deploymentId") && sharedStaging["version"] == 1) { "Invalid non-secret staging configuration" }

fun stagingUrl(property: String, fallback: String): String {
    val value = providers.gradleProperty(property).orElse(fallback).get().trimEnd('/')
    val uri = URI(value)
    check(uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null && uri.port == -1 && uri.path.isNullOrEmpty() && uri.query == null && uri.fragment == null && uri.host.lowercase().trimEnd('.') !in setOf("sportsradioapp.onrender.com", "sports-radio-app.vercel.app")) { "Staging requires dedicated HTTPS origins." }
    return value
}
val stagingBackend = stagingUrl("sportsradioStagingBackend", sharedStaging["backendUrl"] as String)
val stagingFrontend = stagingUrl("sportsradioStagingFrontend", sharedStaging["frontendUrl"] as String)
val stagingId = providers.gradleProperty("sportsradioStagingId").orElse(sharedStaging["deploymentId"] as String).get()
val localCa = providers.gradleProperty("sportsradioLocalCa").orNull
val localCaHash = providers.gradleProperty("sportsradioLocalCaSha256").orNull
if(providers.gradleProperty("sportsradioHostedStaging").orNull == "true") {
    check(localCa == null && localCaHash == null) { "Hosted staging must use system certificate trust only" }
    check(stagingBackend == sharedStaging["backendUrl"] && stagingFrontend == sharedStaging["frontendUrl"] && stagingId == sharedStaging["deploymentId"]) { "Hosted staging cannot override centralized public configuration" }
    for (value in listOf(stagingBackend, stagingFrontend)) {
        val host = URI(value).host.lowercase()
        check(host.contains('.') && !host.matches(Regex("[0-9.]+")) && !host.contains(':') && !host.endsWith(".local") && !host.endsWith(".localhost")) { "Hosted staging requires DNS origins, never local addresses" }
    }
}
val stagingTrustResources = layout.buildDirectory.dir("generated/stagingTrust/res")
val prepareStagingTrust by tasks.registering {
    inputs.property("backend", stagingBackend)
    inputs.property("fingerprint", localCaHash ?: "system")
    if (localCa != null) inputs.file(localCa)
    outputs.dir(stagingTrustResources)
    doLast {
        val out = stagingTrustResources.get().asFile
        val xml = out.resolve("xml/staging_network_security_config.xml"); xml.parentFile.mkdirs()
        var scoped = ""
        // Switching from LAN to hosted mode must not package a stale local trust anchor.
        out.resolve("raw/sportsradio_local_ca.cer").delete()
        if (localCa != null) {
            val cert = CertificateFactory.getInstance("X.509").generateCertificate(file(localCa).inputStream()) as X509Certificate
            cert.checkValidity(); check(cert.basicConstraints >= 0)
            val hash = MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }
            check(hash == localCaHash) { "Local CA fingerprint mismatch" }
            val host = URI(stagingBackend).host
            check(host.matches(Regex("[0-9.]+"))) { "Local trust is restricted to a LAN IP" }
            val raw = out.resolve("raw/sportsradio_local_ca.cer"); raw.parentFile.mkdirs(); raw.writeBytes(cert.encoded)
            scoped = "<domain-config cleartextTrafficPermitted=\"false\"><domain includeSubdomains=\"false\">$host</domain><trust-anchors><certificates src=\"@raw/sportsradio_local_ca\"/></trust-anchors></domain-config>"
        }
        xml.writeText("<network-security-config><base-config cleartextTrafficPermitted=\"false\"><trust-anchors><certificates src=\"system\"/></trust-anchors></base-config>$scoped</network-security-config>")
    }
}
check(stagingId.matches(Regex("[a-z0-9-]{8,64}"))) { "Invalid staging deployment ID" }

android {
    namespace = "com.sportsradio.tv"
    compileSdk = 36

    buildFeatures { buildConfig = true; resValues = true }
    defaultConfig {
        applicationId = "com.sportsradio.tv.capture"
        minSdk = 29
        targetSdk = 36
        versionCode = 5
        versionName = "0.4.0"
        buildConfigField("boolean", "IS_STAGING", "false")
        buildConfigField("String", "BACKEND_URL", "\"https://sportsradioapp.onrender.com\"")
        buildConfigField("String", "LISTENER_URL", "\"https://sports-radio-app.vercel.app\"")
        buildConfigField("String", "DEPLOYMENT_ID", "\"production\"")
        resValue("string", "app_name", "SportsRadio Capture")
    }
    buildTypes {
        create("staging") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            matchingFallbacks += listOf("debug")
            buildConfigField("boolean", "IS_STAGING", "true")
            buildConfigField("String", "BACKEND_URL", "\"$stagingBackend\"")
            buildConfigField("String", "LISTENER_URL", "\"$stagingFrontend\"")
            buildConfigField("String", "DEPLOYMENT_ID", "\"$stagingId\"")
            resValue("string", "app_name", "SportsRadio TV STAGING")
        }
    }
    sourceSets.getByName("staging").res.srcDir(stagingTrustResources.get().asFile)
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
tasks.matching { it.name == "preStagingBuild" }.configureEach { dependsOn(prepareStagingTrust) }

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

plugins { id("com.android.application") }

android {
    namespace = "com.sportsradio.tv"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.sportsradio.tv.capture"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    testImplementation("junit:junit:4.13.2")
}

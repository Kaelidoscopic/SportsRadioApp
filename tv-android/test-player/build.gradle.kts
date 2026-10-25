plugins { id("com.android.application") }
android {
    namespace = "com.sportsradio.tv.testplayer"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.sportsradio.tv.testplayer"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].res.srcDir("../app/src/main/res")
}

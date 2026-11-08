package com.sportsradio.tv.device
import com.sportsradio.tv.BuildConfig
import com.sportsradio.tv.stagingIdentityMatches
import org.junit.Assert.*
import org.junit.Test
class StagingIsolationTests {
    @Test fun endpointIdentityCannotAcceptProductionOrOtherStage() {
        assertTrue(stagingIdentityMatches("staging","stage-a","stage-a"))
        assertFalse(stagingIdentityMatches("production","stage-a","stage-a"))
        assertFalse(stagingIdentityMatches("staging","stage-b","stage-a"))
    }
    @Test fun stagingBuildHasSeparateInstallAndNonProductionUrls() {
        if(BuildConfig.IS_STAGING) {
            assertTrue(BuildConfig.APPLICATION_ID.endsWith(".staging"))
            assertNotEquals("https://sportsradioapp.onrender.com",BuildConfig.BACKEND_URL)
            assertNotEquals("https://sports-radio-app.vercel.app",BuildConfig.LISTENER_URL)
        } else assertEquals("com.sportsradio.tv.capture",BuildConfig.APPLICATION_ID)
    }
}

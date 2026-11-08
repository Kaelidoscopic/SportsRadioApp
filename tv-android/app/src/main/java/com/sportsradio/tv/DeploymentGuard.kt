package com.sportsradio.tv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

fun stagingIdentityMatches(environment: String, actual: String, expected: String): Boolean = environment=="staging" && actual==expected
/** Non-secret identity probe before any staging device credentials or room socket. */
object DeploymentGuard {
    fun verify() {
        if (!BuildConfig.IS_STAGING) return
        val connection=URI(BuildConfig.BACKEND_URL+"/api/deployment").toURL().openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects=false; connection.connectTimeout=5000;connection.readTimeout=5000
            val code=connection.responseCode
            if(code==401 || code==403) throw DeploymentFailure("AUTH")
            if(code!=200) throw DeploymentFailure("HTTP")
            val data=try { JSONObject(connection.inputStream.bufferedReader().use { it.readText() }) }
                catch(_: org.json.JSONException) { throw DeploymentFailure("RESPONSE") }
            if(!stagingIdentityMatches(data.optString("environment"), data.optString("deploymentId"),BuildConfig.DEPLOYMENT_ID)) throw DeploymentFailure("CONFIG")
        } finally { connection.disconnect() }
    }
}

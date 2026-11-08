package com.sportsradio.tv

import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

class DeploymentFailure(val category: String) : Exception()
class SavedIdentityFailure(val explanation: String, cause: Throwable? = null) : IllegalStateException(explanation, cause)

/** Only fixed, non-secret messages reach UI; never expose exception text, URLs or headers. */
fun connectionFailureMessage(error: Exception): String = when (error) {
    is SavedIdentityFailure -> error.explanation
    is SSLException -> "TLS certificate validation failed. Check TV date, backend certificate and staging APK trust. Do not bypass validation."
    is UnknownHostException -> "Network: backend hostname could not be resolved. Check TV internet and configured hostname."
    is SocketTimeoutException -> "Network: backend request timed out. Check connectivity and service availability, then retry."
    is DeploymentFailure -> when(error.category) {
        "AUTH" -> "Authentication: backend access was rejected. Check deployment access policy; credentials were not sent by the identity probe."
        "CONFIG" -> "Configuration: backend environment or deployment ID does not match this build."
        "HTTP" -> "Backend unavailable: identity endpoint rejected the request. Check staging service status."
        else -> "Configuration: backend identity response is invalid. Check the configured API endpoint."
    }
    is IOException -> "Network: unable to reach backend. Check Wi-Fi, firewall and service availability."
    else -> "Request failed safely. Check staging configuration and retry; credentials were not reset."
}

/** Main-thread coordinator. Verification has no shared authorization flag or pairing state. */
class VerifiedConnection(
    private val verify: () -> Unit,
    private val work: (() -> Unit) -> Unit,
    private val deliver: (() -> Unit) -> Unit,
    private val waiting: () -> Unit,
    private val failed: (String) -> Unit
) {
    private var generation = 0
    private var pending = false
    fun connect(open: () -> Unit) {
        if(pending) return
        pending = true
        val attempt = ++generation
        waiting()
        work {
            val failure = try { verify(); null } catch(error: Exception) { error }
            deliver {
                if(attempt == generation) {
                    pending = false
                    if(failure == null) {
                        try { open() } catch(error: Exception) { failed(connectionFailureMessage(error)) }
                    } else failed(connectionFailureMessage(failure))
                }
            }
        }
    }
    fun cancel() { generation++; pending = false }
}

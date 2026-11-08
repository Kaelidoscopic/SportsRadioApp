package com.sportsradio.tv

import org.junit.Assert.*
import org.junit.Test
import java.net.UnknownHostException
import java.net.SocketTimeoutException
import javax.net.ssl.SSLHandshakeException

class ConnectionVerificationTests {
    private class Harness {
        val worker=mutableListOf<() -> Unit>(); val main=mutableListOf<() -> Unit>()
        var failure: Exception?=null; var opens=0; var waiting=0; var message=""
        val gate=VerifiedConnection({failure?.let { throw it }},{worker.add(it)},{main.add(it)},{waiting++},{message=it})
        fun request()=gate.connect { opens++ }
        fun complete() { worker.removeAt(0)(); main.removeAt(0)() }
    }
    @Test fun connectionVerifiesAsynchronouslyWithoutPairing() {
        val h=Harness(); h.request(); assertEquals(0,h.opens);assertEquals(1,h.waiting)
        h.worker.removeAt(0)();assertEquals(0,h.opens);h.main.removeAt(0)();assertEquals(1,h.opens)
    }
    @Test fun repeatedConnectCoalescesWhileVerificationIsPending() {
        val h=Harness();repeat(3){h.request()};assertEquals(1,h.worker.size);h.complete();assertEquals(1,h.opens)
    }
    @Test fun failedIdentityCheckDoesNotOpenSocketAndCanRetry() {
        val h=Harness();h.failure=DeploymentFailure("CONFIG");h.request();h.complete()
        assertEquals(0,h.opens);assertTrue(h.message.startsWith("Configuration:"))
        h.failure=null;h.request();h.complete();assertEquals(1,h.opens)
    }
    @Test fun cancellationAndShutdownDiscardLateVerification() {
        val h=Harness();h.request();h.gate.cancel();h.request();h.complete();assertEquals(0,h.opens)
        h.complete();assertEquals(1,h.opens)
    }
    @Test fun pairingProbeFailureCannotInvalidateVerifiedRoomConnection() {
        val h=Harness();h.request();h.complete()
        // A separate pairing verifier has no shared authorization flag to reset.
        val pairing=Harness();pairing.failure=SSLHandshakeException("secret must not be displayed")
        pairing.request();pairing.complete();assertEquals(0,pairing.opens);assertEquals(1,h.opens)
        h.request();h.complete();assertEquals(2,h.opens)
    }
    @Test fun diagnosticsDistinguishTlsNetworkConfigAuthAndSavedIdentityWithoutLeakingCauses() {
        val failures=listOf(
            SSLHandshakeException("secret") to "TLS",
            UnknownHostException("secret") to "Network:",
            SocketTimeoutException("secret") to "Network:",
            DeploymentFailure("CONFIG") to "Configuration:",
            DeploymentFailure("AUTH") to "Authentication:",
            SavedIdentityFailure("Saved identity unavailable",IllegalStateException("secret")) to "Saved identity"
        )
        failures.forEach { (error,prefix) -> val value=connectionFailureMessage(error);assertTrue(value.startsWith(prefix));assertFalse(value.contains("secret")) }
    }
}

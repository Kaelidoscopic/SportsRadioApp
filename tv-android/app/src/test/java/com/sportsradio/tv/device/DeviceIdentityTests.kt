package com.sportsradio.tv.device
import org.junit.Assert.*
import org.junit.Test
class DeviceIdentityTests {
    private class Store: IdentityStore { var value: DeviceIdentity?=null; override fun load()=value; override fun save(identity: DeviceIdentity) { value=identity } }
    @Test fun firstLaunchPersistsRandomIdentityAndRestartsReuseIt() {
        val store=Store(); val first=IdentityRepository("https://backend",store).get()
        assertTrue(first.id.matches(Regex("[a-f0-9-]{36}"))); assertTrue(first.credential.matches(Regex("[a-f0-9]{64}")))
        assertEquals(first,IdentityRepository("https://backend",store).get())
        assertNotEquals(first.id,IdentityRepository("https://backend",Store()).get().id)
        assertFalse(first.toString().contains(first.credential))
    }
    @Test fun rotationStagesNewKeyBeforePromotionAndSurvivesRestart() {
        val store=Store(); val repo=IdentityRepository("https://backend",store);val first=repo.get(); val staged=repo.stageRotation()
        assertEquals(first.credential,staged.credential);assertNotEquals(first.credential,staged.pending)
        val restarted=IdentityRepository("https://backend",store)
        assertEquals(staged,restarted.get()); val promoted=restarted.promote(staged)
        assertEquals(staged.pending,promoted.credential);assertNull(promoted.pending);assertEquals(first.id,promoted.id)
    }
    @Test fun explicitLostCredentialRegistrationNeverReclaimsOldId() {
        val repo=IdentityRepository("https://backend",Store());val old=repo.get();val next=repo.replace()
        assertNotEquals(old.id,next.id);assertNotEquals(old.credential,next.credential)
    }
    @Test fun storageFailureNeverFallsBackToEphemeralIdentity() {
        val repo=IdentityRepository("https://backend",object:IdentityStore {
            override fun load(): DeviceIdentity?=null
            override fun save(identity:DeviceIdentity) { error("Disk failure") }
        })
        assertThrows(IllegalStateException::class.java) { repo.get() }
    }
    @Test fun backendMismatchIsDiagnosedWithoutResettingSavedIdentity() {
        val store=Store();val old=IdentityRepository("https://local-stage",store).get()
        val error=assertThrows(com.sportsradio.tv.SavedIdentityFailure::class.java) { IdentityRepository("https://hosted-stage",store).get() }
        assertTrue(error.explanation.contains("another backend"));assertEquals(old,store.value)
    }
    @Test fun pairingStateExpiresWithoutNetworkAndDoesNotResurrectCode() {
        val state=PairingState();state.update("Waiting for Pairing",100,"ABCDE-FGHJK")
        assertFalse(state.value.toString().contains("ABCDE-FGHJK"))
        assertEquals("Waiting for Pairing",state.view(99).status);assertEquals("Expired",state.view(100).status)
        state.update("Paired",100);assertEquals("",state.view(0).code)
        state.update("Waiting for Pairing",200);assertEquals("",state.view(0).code)
        assertThrows(IllegalArgumentException::class.java) { state.update("invented",0) }
    }
}

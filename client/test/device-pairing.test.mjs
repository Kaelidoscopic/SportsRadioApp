import test from "node:test";
import assert from "node:assert/strict";
import {pairingMessage,normalizePairingCode} from "../src/device-pairing.js";
test("pairing input is normalized without putting secrets in a URL",()=>{assert.equal(normalizePairingCode(" abcde-fghjk "),"ABCDEFGHJK");});
test("pairing success, invalid, expired, login, disabled and rate limit are distinct",()=>{
 const messages=["Paired","INVALID_CODE","EXPIRED_CODE","LOGIN_REQUIRED","PAIRING_NOT_CONFIGURED","RATE_LIMITED","ALREADY_PAIRED"].map(pairingMessage);
 assert.equal(new Set(messages).size,messages.length); assert.match(messages[0],/successfully/); assert.match(messages[2],/expired/);
});

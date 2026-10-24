const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { CredentialStore } = require('../src/credential-store.cjs');

test('store writes ciphertext, round trips ownership, and refuses plaintext fallback', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsradio-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // AES test double verifies the storage contract, not Windows DPAPI itself.
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const safeStorage = { isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(value) { const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([cipher.getAuthTag(), encrypted]); },
    async decryptStringAsync(value) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(value.subarray(0, 16)); return { result: Buffer.concat([decipher.update(value.subarray(16)), decipher.final()]).toString(), shouldReEncrypt: false }; }
  };
  const store = new CredentialStore(path.join(directory, 'room.dpapi'), safeStorage);
  await store.initialize(); assert.equal(store.load(), null);
  const record = { credential: 'secret-test-value', roomCode: 'DESK' }; await store.save(record);
  assert.equal(fs.readFileSync(store.file).includes(Buffer.from(record.credential)), false);
  assert.deepEqual(store.load(), record);
  const reloaded = new CredentialStore(store.file, safeStorage); await reloaded.initialize(); assert.deepEqual(reloaded.load(), record);
  safeStorage.isAsyncEncryptionAvailable = async () => false; await assert.rejects(store.save(record), /unavailable/);
  store.clear(); assert.equal(fs.existsSync(store.file), false);
});

test('clearing ownership while encryption is pending cannot resurrect the saved credential', async () => {
  let finish;
  const store = new CredentialStore(path.join(os.tmpdir(), `unused-sportsradio-${crypto.randomUUID()}`), {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: () => new Promise((resolve) => { finish = resolve; })
  });
  const operation = store.save({ credential: 'obsolete' });
  await new Promise((resolve) => setImmediate(resolve)); store.clear(); finish(Buffer.from('encrypted'));
  await operation; assert.equal(store.load(), null); assert.equal(fs.existsSync(store.file), false);
});

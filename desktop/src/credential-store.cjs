const fs = require('node:fs');
const path = require('node:path');

class CredentialStore {
  constructor(file, safeStorage) { this.file = file; this.safeStorage = safeStorage; this.record = null; this.revision = 0; }
  async available() {
    if (!await this.safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Room credentials cannot be saved.');
  }
  async initialize() {
    await this.available();
    if (!fs.existsSync(this.file)) return null;
    try {
      const decrypted = await this.safeStorage.decryptStringAsync(fs.readFileSync(this.file));
      this.record = JSON.parse(decrypted.result);
      if (decrypted.shouldReEncrypt) await this.save(this.record);
      return this.record;
    } catch { throw new Error('Saved room could not be decrypted. Use the original Windows account or reset saved room data.'); }
  }
  load() { return this.record; }
  async save(record) {
    const revision = ++this.revision;
    await this.available();
    const encrypted = await this.safeStorage.encryptStringAsync(JSON.stringify(record));
    if (revision !== this.revision) return; // A concurrent End Room cancels pending persistence.
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(temp, encrypted, { mode: 0o600 });
      fs.renameSync(temp, this.file);
      this.record = record;
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  clear() { this.revision++; this.record = null; if (fs.existsSync(this.file)) fs.unlinkSync(this.file); }
}
module.exports = { CredentialStore };

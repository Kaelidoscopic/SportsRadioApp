export const pairingMessage = code => ({
  EXPIRED_CODE: "That code expired. Request a new code on the TV.",
  INVALID_CODE: "Invalid or already used code. Check the TV and try again.",
  ALREADY_PAIRED: "This TV is already paired. Ownership was not changed.",
  LOGIN_REQUIRED: "Please sign in again.",
  PAIRING_NOT_CONFIGURED: "TV pairing is not enabled on this server yet.",
  RATE_LIMITED: "Too many attempts. Wait before trying again.",
  Paired: "TV paired successfully."
}[code] || "Could not connect. Please try again.");
export function normalizePairingCode(value) { return String(value).trim().toUpperCase().replace(/-/g, ""); }

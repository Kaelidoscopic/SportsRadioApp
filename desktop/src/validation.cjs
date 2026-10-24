function serviceUrl(value, allowLan = false) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid server URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a complete http:// or https:// URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !local && !allowLan)) {
    throw new Error('Use HTTPS, or localhost HTTP. LAN HTTP requires SPORTSRADIO_ALLOW_INSECURE_LAN=1 for trusted development networks.');
  }
  return url.href.replace(/\/$/, '');
}
function roomInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.roomCode !== 'string' || !/^[a-zA-Z0-9]{0,32}$/.test(value.roomCode) ||
      typeof value.roomName !== 'string' || value.roomName.length > 120) throw new Error('Room code must be 0–32 letters/digits; room name at most 120 characters.');
  return { roomCode: value.roomCode.toUpperCase(), roomName: value.roomName.trim() };
}
function signalPayload(value, members) {
  if (!value || typeof value !== 'object' || !members.includes(value.target)) throw new Error('Invalid listener.');
  if (value.event === 'webrtc-offer' && value.offer?.type === 'offer' && typeof value.offer.sdp === 'string' && value.offer.sdp.length <= 131072) {
    return { event: value.event, payload: { target: value.target, offer: { type: 'offer', sdp: value.offer.sdp } } };
  }
  if (value.event === 'webrtc-ice-candidate' && typeof value.candidate?.candidate === 'string' && value.candidate.candidate.length <= 8192) {
    const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = value.candidate;
    if ((sdpMid != null && typeof sdpMid !== 'string') || (sdpMLineIndex != null && !Number.isInteger(sdpMLineIndex)) || (usernameFragment != null && typeof usernameFragment !== 'string')) throw new Error('Invalid ICE candidate.');
    return { event: value.event, payload: { target: value.target, candidate: { candidate, sdpMid, sdpMLineIndex, usernameFragment } } };
  }
  throw new Error('Unsupported signaling payload.');
}
module.exports = { serviceUrl, roomInput, signalPayload };

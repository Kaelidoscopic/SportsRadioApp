// Explicit allowlist: never return SDP, candidate strings/addresses, URLs or secrets.
export function audioCounters(stats) {
  const result = { bytesSent: 0, packetsSent: 0, sourceEnergy: 0, sourceDuration: 0, audioLevel: 0 };
  stats.forEach((stat) => {
    if (stat.type === 'outbound-rtp' && (stat.kind || stat.mediaType) === 'audio' && !stat.isRemote) {
      result.bytesSent += stat.bytesSent || 0; result.packetsSent += stat.packetsSent || 0;
    }
    if (stat.type === 'media-source' && stat.kind === 'audio') {
      result.sourceEnergy += stat.totalAudioEnergy || 0;
      result.sourceDuration += stat.totalSamplesDuration || 0;
      result.audioLevel = stat.audioLevel || 0;
    }
    if (stat.type === 'transport' && stat.selectedCandidatePairId) {
      const pair = stats.get(stat.selectedCandidatePairId);
      if (pair) {
        result.localCandidateType = stats.get(pair.localCandidateId)?.candidateType || 'unknown';
        result.remoteCandidateType = stats.get(pair.remoteCandidateId)?.candidateType || 'unknown';
      }
    }
  });
  return result;
}

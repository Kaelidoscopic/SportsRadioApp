// Explicit allowlist: never return SDP, candidate strings/addresses, URLs or secrets.
export function audioCounters(stats) {
  const result = { bytesSent: 0, packetsSent: 0, sourceEnergy: null, sourceDuration: null, audioLevel: null };
  stats.forEach((stat) => {
    if (stat.type === 'outbound-rtp' && (stat.kind || stat.mediaType) === 'audio' && !stat.isRemote) {
      result.bytesSent += stat.bytesSent || 0; result.packetsSent += stat.packetsSent || 0;
    }
    if (stat.type === 'media-source' && stat.kind === 'audio') {
      if (Number.isFinite(stat.totalAudioEnergy)) result.sourceEnergy = (result.sourceEnergy ?? 0) + stat.totalAudioEnergy;
      if (Number.isFinite(stat.totalSamplesDuration)) result.sourceDuration = (result.sourceDuration ?? 0) + stat.totalSamplesDuration;
      if (Number.isFinite(stat.audioLevel)) result.audioLevel = Math.max(result.audioLevel ?? 0, stat.audioLevel);
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

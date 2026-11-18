(function attachAudioState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.WebcamMonitorAudioState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEFAULT_VOLUME = 80;

  function clampVolume(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_VOLUME;
    return Math.round(Math.min(100, Math.max(0, numeric)));
  }

  function createAudioState(initialVolume = DEFAULT_VOLUME) {
    let volume = clampVolume(initialVolume);
    let muted = false;
    let previousVolume = volume > 0 ? volume : DEFAULT_VOLUME;

    function snapshot() {
      return { volume, muted, effectiveVolume: muted ? 0 : volume };
    }

    return {
      snapshot,
      setVolume(nextVolume) {
        volume = clampVolume(nextVolume);
        if (volume > 0) previousVolume = volume;
        return snapshot();
      },
      setMuted(nextMuted) {
        const shouldMute = Boolean(nextMuted);
        if (shouldMute === muted) return snapshot();
        if (shouldMute && volume > 0) previousVolume = volume;
        muted = shouldMute;
        if (!muted && volume === 0) volume = previousVolume;
        return snapshot();
      },
      toggleMuted() {
        return this.setMuted(!muted);
      },
    };
  }

  function chooseAvailableOutput(savedOutputId, outputs) {
    return outputs.some((output) => output.id === savedOutputId) ? savedOutputId : "default";
  }

  function percentToDirectShowVolume(percent) {
    const value = clampVolume(percent);
    if (value === 0) return -10000;
    return Math.round(2000 * Math.log10(value / 100));
  }

  return {
    DEFAULT_VOLUME,
    clampVolume,
    createAudioState,
    chooseAvailableOutput,
    percentToDirectShowVolume,
  };
});

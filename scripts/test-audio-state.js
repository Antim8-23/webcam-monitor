const assert = require("assert");
const {
  chooseAvailableOutput,
  createAudioState,
  percentToDirectShowVolume,
} = require("../src/audio-state");

function testVolumeAndMuteState() {
  const state = createAudioState(72);
  assert.deepStrictEqual(state.snapshot(), { volume: 72, muted: false, effectiveVolume: 72 });

  assert.deepStrictEqual(state.toggleMuted(), { volume: 72, muted: true, effectiveVolume: 0 });
  assert.deepStrictEqual(state.setVolume(36), { volume: 36, muted: true, effectiveVolume: 0 });
  assert.deepStrictEqual(state.toggleMuted(), { volume: 36, muted: false, effectiveVolume: 36 });

  state.setVolume(0);
  state.setMuted(true);
  assert.deepStrictEqual(state.setMuted(false), { volume: 36, muted: false, effectiveVolume: 36 });
}

function testOutputFallback() {
  const outputs = [{ id: "default" }, { id: "web:headset" }];
  assert.strictEqual(chooseAvailableOutput("web:headset", outputs), "web:headset");
  assert.strictEqual(chooseAvailableOutput("missing-device", outputs), "default");
}

function testDirectShowVolumeScale() {
  assert.strictEqual(percentToDirectShowVolume(100), 0);
  assert.strictEqual(percentToDirectShowVolume(50), -602);
  assert.strictEqual(percentToDirectShowVolume(0), -10000);
}

testVolumeAndMuteState();
testOutputFallback();
testDirectShowVolumeScale();
console.log("Audio-state tests passed.");

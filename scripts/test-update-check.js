const assert = require("assert");
const {
  parseSemVer,
  compareSemVer,
  isSemVerGreater,
  validateLatestJson,
} = require("../electron/update-check");

function testSemVer() {
  assert.strictEqual(isSemVerGreater("1.0.3", "1.0.2"), true);
  assert.strictEqual(isSemVerGreater("1.0.2", "1.0.2"), false);
  assert.strictEqual(isSemVerGreater("1.1.0", "1.0.9"), true);
  assert.strictEqual(isSemVerGreater("2.0.0", "1.9.9"), true);
  assert.strictEqual(isSemVerGreater("1.0.10", "1.0.2"), true);
  assert.strictEqual(isSemVerGreater("1.0.2", "1.0.10"), false);

  assert.throws(() => compareSemVer("1.0", "1.0.0"));
  assert.throws(() => compareSemVer("1.0.0", "bad"));
  assert.strictEqual(parseSemVer("1.0"), null);
  assert.deepStrictEqual(parseSemVer("1.0.0"), [1, 0, 0]);
}

function testValidateLatestJson() {
  const valid = validateLatestJson({
    schemaVersion: 1,
    app: "Webcam Monitor",
    channel: "stable",
    version: "1.0.3",
    releaseDate: "2026-09-02",
    portable: {
      fileName: "WebcamMonitor-portable-v1.0.3.exe",
      url: "https://jati-digital.de/downloads/webcam-monitor/WebcamMonitor-portable-v1.0.3.exe",
      size: 123456,
      sha256: "a".repeat(64),
    },
    releaseNotes: "### Added\n\n- Test",
  });

  assert.strictEqual(valid.version, "1.0.3");
  assert.strictEqual(valid.downloadUrl.includes("jati-digital.de"), true);

  assert.throws(() =>
    validateLatestJson({
      schemaVersion: 2,
      app: "Webcam Monitor",
      channel: "stable",
      version: "1.0.3",
      releaseDate: "2026-09-02",
      portable: {
        fileName: "WebcamMonitor-portable-v1.0.3.exe",
        url: "https://jati-digital.de/downloads/webcam-monitor/WebcamMonitor-portable-v1.0.3.exe",
        size: 123456,
        sha256: "a".repeat(64),
      },
    })
  );
}

testSemVer();
testValidateLatestJson();
console.log("Update-check tests passed.");

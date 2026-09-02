const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DOWNLOAD_BASE = "https://jati-digital.de/downloads/webcam-monitor";
const GITHUB_REPO = "https://github.com/Antim8-23/webcam-monitor";

const version = process.argv[2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!version) {
  fail(
    "Verwendung: node scripts/generate-latest-json.js <version>\n" +
      "Beispiel:  node scripts/generate-latest-json.js 1.0.1"
  );
}

const rootDir = path.join(__dirname, "..");
const packagePath = path.join(rootDir, "package.json");
const changelogPath = path.join(rootDir, "CHANGELOG.md");
const distDir = path.join(rootDir, "dist");
const outputPath = path.join(distDir, "latest.json");

if (!fs.existsSync(packagePath)) {
  fail(`package.json nicht gefunden: ${packagePath}`);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (pkg.version !== version) {
  fail(
    `Versionskonflikt: Argument (${version}) stimmt nicht mit package.json (${pkg.version}) ueberein.`
  );
}

if (!fs.existsSync(changelogPath)) {
  fail(`CHANGELOG.md nicht gefunden: ${changelogPath}`);
}

const changelog = fs.readFileSync(changelogPath, "utf8");
const escapedVersion = version.replace(/\./g, "\\.");
const headerPattern = new RegExp(
  `^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`,
  "m"
);
const headerMatch = changelog.match(headerPattern);

if (!headerMatch) {
  fail(
    `Kein CHANGELOG-Abschnitt mit Release-Datum fuer Version [${version}] gefunden.\n` +
      "Erwartet: ## [X.Y.Z] - YYYY-MM-DD"
  );
}

const releaseDate = headerMatch[1];
const startIndex = headerMatch.index + headerMatch[0].length;
const rest = changelog.slice(startIndex);
const nextSectionIndex = rest.search(/^## \[/m);
const section =
  nextSectionIndex === -1 ? rest : rest.slice(0, nextSectionIndex);
const releaseNotes = section.trim();

if (!releaseNotes) {
  fail(`CHANGELOG-Abschnitt fuer Version [${version}] ist leer.`);
}

const portableName = `WebcamMonitor-portable-v${version}.exe`;
const installerName = `WebcamMonitor-setup-v${version}.exe`;
const checksumName = `WebcamMonitor-SHA256SUMS-v${version}.txt`;

const portablePath = path.join(distDir, portableName);
const installerPath = path.join(distDir, installerName);
const checksumPath = path.join(distDir, checksumName);

for (const [label, filePath] of [
  ["Portable", portablePath],
  ["Installer", installerPath],
  ["SHA256SUMS", checksumPath],
]) {
  if (!fs.existsSync(filePath)) {
    fail(`${label}-Datei fehlt: ${filePath}`);
  }
}

function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function parseChecksumFile(content, fileName) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(/^([a-f0-9]{64})\s{2}(.+)$/);
    if (!match) {
      continue;
    }
    if (match[2] === fileName) {
      return match[1];
    }
  }
  return null;
}

function validateHash(hash, label) {
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
    fail(
      `Ungueltiger SHA256 fuer ${label}: erwartet exakt 64 Hex-Zeichen (lowercase).`
    );
  }
}

function getFileSize(filePath, label) {
  const size = fs.statSync(filePath).size;
  if (!Number.isFinite(size) || size <= 0) {
    fail(`Ungueltige Dateigroesse fuer ${label}: ${size}`);
  }
  return size;
}

const checksumContent = fs.readFileSync(checksumPath, "utf8");
const portableHashFromFile = parseChecksumFile(checksumContent, portableName);
const installerHashFromFile = parseChecksumFile(checksumContent, installerName);

if (!portableHashFromFile) {
  fail(`SHA256 fuer ${portableName} fehlt in ${checksumName}.`);
}
if (!installerHashFromFile) {
  fail(`SHA256 fuer ${installerName} fehlt in ${checksumName}.`);
}

const portableHashComputed = computeSha256(portablePath);
const installerHashComputed = computeSha256(installerPath);

if (portableHashFromFile !== portableHashComputed) {
  fail(
    `SHA256-Konflikt fuer ${portableName}: Checksum-Datei und berechneter Hash stimmen nicht ueberein.`
  );
}
if (installerHashFromFile !== installerHashComputed) {
  fail(
    `SHA256-Konflikt fuer ${installerName}: Checksum-Datei und berechneter Hash stimmen nicht ueberein.`
  );
}

validateHash(portableHashComputed, portableName);
validateHash(installerHashComputed, installerName);

const portableSize = getFileSize(portablePath, portableName);
const installerSize = getFileSize(installerPath, installerName);

const metadata = {
  schemaVersion: 1,
  app: "Webcam Monitor",
  channel: "stable",
  version,
  releaseDate,
  releaseUrl: `${GITHUB_REPO}/releases/tag/v${version}`,
  sourceUrl: GITHUB_REPO,
  portable: {
    fileName: portableName,
    url: `${DOWNLOAD_BASE}/${portableName}`,
    size: portableSize,
    sha256: portableHashComputed,
  },
  installer: {
    fileName: installerName,
    url: `${DOWNLOAD_BASE}/${installerName}`,
    size: installerSize,
    sha256: installerHashComputed,
  },
  checksumsUrl: `${DOWNLOAD_BASE}/${checksumName}`,
  releaseNotes,
};

const jsonText = `${JSON.stringify(metadata, null, 2)}\n`;

try {
  JSON.parse(jsonText);
} catch (error) {
  fail(`Generiertes JSON ist nicht parsebar: ${error.message}`);
}

fs.writeFileSync(outputPath, jsonText, "utf8");

try {
  JSON.parse(fs.readFileSync(outputPath, "utf8"));
} catch (error) {
  fail(`Geschriebenes latest.json ist nicht parsebar: ${error.message}`);
}

console.log(`latest.json erstellt: ${outputPath}`);

const fs = require("fs");
const path = require("path");

const version = process.argv[2];
const outputPath = process.argv[3];

if (!version) {
  console.error("Verwendung: node scripts/extract-changelog.js <version> [output-file]");
  console.error("Beispiel:  node scripts/extract-changelog.js 1.0.0 release-notes.md");
  process.exit(1);
}

const changelogPath = path.join(__dirname, "..", "CHANGELOG.md");

if (!fs.existsSync(changelogPath)) {
  console.error(`CHANGELOG.md nicht gefunden: ${changelogPath}`);
  process.exit(1);
}

const content = fs.readFileSync(changelogPath, "utf8");
const escapedVersion = version.replace(/\./g, "\\.");
const sectionPattern = new RegExp(
  `^## \\[${escapedVersion}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|$)`,
  "m"
);
const match = content.match(sectionPattern);

if (!match) {
  console.error(
    `Kein CHANGELOG-Abschnitt fuer Version [${version}] gefunden.`
  );
  process.exit(1);
}

const section = match[1].trim();

if (!section) {
  console.error(`CHANGELOG-Abschnitt fuer Version [${version}] ist leer.`);
  process.exit(1);
}

if (outputPath) {
  fs.writeFileSync(outputPath, `${section}\n`, "utf8");
} else {
  process.stdout.write(`${section}\n`);
}

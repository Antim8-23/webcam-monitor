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
const headerPattern = new RegExp(`^## \\[${escapedVersion}\\][^\\n]*$`, "m");
const headerMatch = content.match(headerPattern);

if (!headerMatch) {
  console.error(
    `Kein CHANGELOG-Abschnitt fuer Version [${version}] gefunden.`
  );
  process.exit(1);
}

const startIndex = headerMatch.index + headerMatch[0].length;
const rest = content.slice(startIndex);
const nextSectionIndex = rest.search(/^## \[/m);
const section =
  nextSectionIndex === -1 ? rest : rest.slice(0, nextSectionIndex);
const trimmed = section.trim();

if (!trimmed) {
  console.error(`CHANGELOG-Abschnitt fuer Version [${version}] ist leer.`);
  process.exit(1);
}

if (outputPath) {
  fs.writeFileSync(outputPath, `${trimmed}\n`, "utf8");
} else {
  process.stdout.write(`${trimmed}\n`);
}

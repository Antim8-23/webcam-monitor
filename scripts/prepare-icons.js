const fs = require("fs");
const path = require("path");

const assetsDir = path.join(__dirname, "..", "assets");
const sourcePng = path.join(assetsDir, "icon.png");
const outputIco = path.join(assetsDir, "icon.ico");
const buildPng = path.join(assetsDir, "icon-build.png");

const ZOOM = 1.45;
const OUTPUT_SIZE = 256;

async function prepareIcons() {
  if (!fs.existsSync(sourcePng)) {
    console.error("assets/icon.png fehlt. Bitte zuerst dein Icon dort ablegen.");
    process.exit(1);
  }

  const sharp = (await import("sharp")).default;
  const metadata = await sharp(sourcePng).metadata();
  const base = Math.min(metadata.width || OUTPUT_SIZE, metadata.height || OUTPUT_SIZE);
  const cropSize = Math.max(1, Math.round(base / ZOOM));
  const left = Math.round(((metadata.width || base) - cropSize) / 2);
  const top = Math.round(((metadata.height || base) - cropSize) / 2);

  await sharp(sourcePng)
    .extract({ left, top, width: cropSize, height: cropSize })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .png()
    .toFile(buildPng);

  const { default: pngToIco } = await import("png-to-ico");
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = await Promise.all(
    sizes.map((size) =>
      sharp(buildPng).resize(size, size).png().toBuffer()
    )
  );

  fs.writeFileSync(outputIco, await pngToIco(pngBuffers));

  console.log(`Quelle: ${metadata.width}x${metadata.height}px`);
  console.log(`Erstellt: ${outputIco}`);
  console.log(`Vorschau: ${buildPng}`);
}

prepareIcons().catch((error) => {
  console.error("Icon-Vorbereitung fehlgeschlagen:", error.message);
  process.exit(1);
});

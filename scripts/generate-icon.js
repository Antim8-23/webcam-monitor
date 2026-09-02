const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

async function createIco(pngPath, icoPath) {
  const { default: pngToIco } = await import("png-to-ico");
  const buffer = await pngToIco(pngPath);
  fs.writeFileSync(icoPath, buffer);
}

const size = 256;
const rowSize = size * 4 + 1;
const raw = Buffer.alloc(rowSize * size);

for (let y = 0; y < size; y += 1) {
  const rowStart = y * rowSize;
  raw[rowStart] = 0;
  for (let x = 0; x < size; x += 1) {
    const offset = rowStart + 1 + x * 4;
    const cx = x - size / 2;
    const cy = y - size / 2;
    const distance = Math.sqrt(cx * cx + cy * cy);

    if (distance < 78) {
      raw[offset] = 59;
      raw[offset + 1] = 130;
      raw[offset + 2] = 246;
      raw[offset + 3] = 255;
    } else if (distance < 98) {
      raw[offset] = 15;
      raw[offset + 1] = 20;
      raw[offset + 2] = 25;
      raw[offset + 3] = 255;
    } else {
      raw[offset] = 26;
      raw[offset + 1] = 35;
      raw[offset + 2] = 50;
      raw[offset + 3] = 255;
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const compressed = zlib.deflateSync(raw);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", compressed),
  chunk("IEND", Buffer.alloc(0)),
]);

const assetsDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(assetsDir, { recursive: true });
const pngPath = path.join(assetsDir, "icon.png");
fs.writeFileSync(pngPath, png);
console.log("Created", pngPath);

createIco(pngPath, path.join(assetsDir, "icon.ico"))
  .then(() => console.log("Created", path.join(assetsDir, "icon.ico")))
  .catch((error) => {
    console.error("ICO-Erstellung fehlgeschlagen:", error.message);
    process.exit(1);
  });

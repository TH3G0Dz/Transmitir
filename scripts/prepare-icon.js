import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const width = 256;
const height = 256;
const pixels = Buffer.alloc((width * 4 + 1) * height);
const pattern = {
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"]
};

function insideRoundedSquare(x, y) {
  const edge = 12;
  const radius = 48;
  const nearestX = Math.max(edge + radius, Math.min(x, width - edge - radius - 1));
  const nearestY = Math.max(edge + radius, Math.min(y, height - edge - radius - 1));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

function paint(x, y, red, green, blue, alpha = 255) {
  const offset = y * (width * 4 + 1) + 1 + x * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = alpha;
}

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (!insideRoundedSquare(x, y)) continue;
    const mix = (x + y) / (width + height - 2);
    paint(x, y, Math.round(77 - 24 * mix), Math.round(138 + 77 * mix), Math.round(255 - 23 * mix));
  }
}

const scale = 18;
const letterWidth = 5 * scale;
const gap = 10;
const startX = Math.round((width - letterWidth * 2 - gap) / 2);
const startY = Math.round((height - 7 * scale) / 2);
for (const [index, letter] of ["T", "H"].entries()) {
  for (const [row, line] of pattern[letter].entries()) {
    for (const [column, filled] of [...line].entries()) {
      if (filled !== "1") continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) paint(startX + index * (letterWidth + gap) + column * scale + x, startY + row * scale + y, 7, 18, 28);
      }
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header.set([8, 6, 0, 0, 0], 8);
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
if (!png.subarray(1, 4).equals(Buffer.from("PNG"))) throw new Error("Falha ao gerar o ícone PNG.");
const destination = path.resolve("desktop/assets/icon.png");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, png);

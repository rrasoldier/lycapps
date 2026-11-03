// Génère l'icône de barre de menus (template : noir + alpha) sans dépendance.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, alphaAt) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const a = Math.round(255 * Math.max(0, Math.min(1, alphaAt(x + 0.5, y + 0.5, size))));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// Anneau + point : évoque une barre de prompt/loupe.
function shape(x, y, s) {
  const u = (x / s) * 16, v = (y / s) * 16, px = 16 / s;
  const d = Math.hypot(u - 7, v - 7);
  const ring = 1 - Math.min(1, Math.max(0, (Math.abs(d - 4.5) - 0.9) / px));
  const dx = (u - v) / Math.SQRT2;
  const handle = u > 10 && u < 14.5 && v > 10 && v < 14.5 ? 1 - Math.min(1, Math.max(0, (Math.abs(dx) - 0.9) / px)) : 0;
  const dot = 1 - Math.min(1, Math.max(0, (Math.hypot(u - 7, v - 7) - 1.3) / px));
  return Math.max(ring, handle, dot);
}
mkdirSync("resources", { recursive: true });
writeFileSync("resources/trayTemplate.png", png(16, shape));
writeFileSync("resources/trayTemplate@2x.png", png(32, shape));
writeFileSync("resources/trayTemplate@2x.png", png(32, shape));

// Generates a placeholder 1024x1024 app-icon.png (radial neon-blue gradient
// on midnight navy) with zero dependencies, so `tauri icon` has a source.
// Replace app-icon.png with real artwork any time and re-run `npm run icon`.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const raw = Buffer.alloc((S * 4 + 1) * S);

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const bg = [5, 8, 15];       // #05080f
const core = [56, 189, 248]; // #38bdf8
const mid = [59, 82, 246];   // indigo falloff

for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  raw[row] = 0; // PNG filter: none
  for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2);
    const dy = (y - S / 2) / (S / 2);
    const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.15);
    let c;
    if (d < 0.45) {
      const t = d / 0.45;
      c = [lerp(core[0], mid[0], t), lerp(core[1], mid[1], t), lerp(core[2], mid[2], t)];
    } else {
      const t = (d - 0.45) / 0.55;
      c = [lerp(mid[0], bg[0], t), lerp(mid[1], bg[1], t), lerp(mid[2], bg[2], t)];
    }
    const o = row + 1 + x * 4;
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
  }
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(new URL("../app-icon.png", import.meta.url), png);
console.log("app-icon.png written (1024x1024). Now run: npx tauri icon app-icon.png");

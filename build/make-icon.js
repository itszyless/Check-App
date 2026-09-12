// Generates build/icon.ico (256x256, PNG-compressed ICO) with zero dependencies,
// using only Node's built-in zlib. Run once: `node build/make-icon.js`
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 256;

function crc32(buf) {
  let c, crcTable = crc32.table;
  if (!crcTable) {
    crcTable = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Build raw RGBA pixel data: a rounded gradient blob with a check mark, on transparent bg.
function buildPixels() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2, cy = SIZE / 2, r = SIZE * 0.46;

  const c1 = [124, 157, 255]; // accent
  const c2 = [192, 132, 252]; // accent-2

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) {
        const t = (x + y) / (SIZE * 2);
        const cr = Math.round(c1[0] + (c2[0] - c1[0]) * t);
        const cg = Math.round(c1[1] + (c2[1] - c1[1]) * t);
        const cb = Math.round(c1[2] + (c2[2] - c1[2]) * t);
        px[idx] = cr; px[idx + 1] = cg; px[idx + 2] = cb;
        const edge = r - dist;
        px[idx + 3] = edge < 2 ? Math.round(255 * (edge / 2)) : 255;
      } else {
        px[idx] = 0; px[idx + 1] = 0; px[idx + 2] = 0; px[idx + 3] = 0;
      }
    }
  }

  // Draw a simple checkmark (white, thick) in the middle.
  function setPx(x, y, a) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const idx = (y * SIZE + x) * 4;
    px[idx] = 255; px[idx + 1] = 255; px[idx + 2] = 255; px[idx + 3] = Math.max(px[idx + 3], a);
  }
  function thickLine(x0, y0, x1, y1, thickness) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let ox = -thickness; ox <= thickness; ox++) {
        for (let oy = -thickness; oy <= thickness; oy++) {
          if (ox * ox + oy * oy <= thickness * thickness) setPx(Math.round(x + ox), Math.round(y + oy), 255);
        }
      }
    }
  }
  thickLine(SIZE * 0.30, SIZE * 0.52, SIZE * 0.45, SIZE * 0.68, SIZE * 0.045);
  thickLine(SIZE * 0.45, SIZE * 0.68, SIZE * 0.74, SIZE * 0.34, SIZE * 0.045);

  return px;
}

function encodePNG(pixels, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function wrapAsIco(pngBuffer, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32BE(pngBuffer.length, 8); // note: LE per spec, fixed below
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12); // offset: 6 header + 16 entry

  return Buffer.concat([header, entry, pngBuffer]);
}

const pixels = buildPixels();
const png = encodePNG(pixels, SIZE);
const ico = wrapAsIco(png, SIZE);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('Wrote build/icon.ico and build/icon.png');

import { deflateSync } from "node:zlib";

const WIDTH = 1200;
const HEIGHT = 630;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const FONT = {
  A: [2, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  C: [3, 4, 4, 4, 3],
  D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3],
  H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7],
  J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5],
  N: [5, 7, 7, 7, 5],
  O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 7, 3],
  R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6],
  T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2],
  W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  0: [7, 5, 5, 5, 7],
  1: [2, 6, 2, 2, 7],
  2: [6, 1, 2, 4, 7],
  3: [6, 1, 2, 1, 6],
  4: [5, 5, 7, 1, 1],
  5: [7, 4, 6, 1, 6],
  6: [3, 4, 7, 5, 2],
  7: [7, 1, 2, 2, 2],
  8: [2, 5, 7, 5, 2],
  9: [2, 5, 7, 1, 6],
  " ": [0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 2],
  ",": [0, 0, 0, 2, 4],
  ":": [0, 2, 0, 2, 0],
  "-": [0, 0, 7, 0, 0],
  _: [0, 0, 0, 0, 7],
  "/": [1, 1, 2, 4, 4],
  "%": [5, 1, 2, 4, 5],
  "!": [2, 2, 2, 0, 2],
  "?": [6, 1, 2, 0, 2],
  "+": [0, 2, 7, 2, 0],
  "&": [2, 5, 2, 5, 5],
  "'": [2, 2, 0, 0, 0],
  "(": [1, 2, 2, 2, 1],
  ")": [4, 2, 2, 2, 4],
  "#": [5, 7, 5, 7, 5],
  "=": [0, 7, 0, 7, 0],
  "@": [3, 4, 5, 4, 3],
};

const COLORS = {
  background: [11, 17, 32],
  panel: [34, 48, 76],
  accent: [88, 166, 255],
  text: [230, 237, 243],
  muted: [139, 148, 158],
  success: [63, 185, 80],
};

let crcTable;

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[n] = value >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function fillRect(canvas, x, y, width, height, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(WIDTH, Math.floor(x + width));
  const y1 = Math.min(HEIGHT, Math.floor(y + height));
  for (let row = y0; row < y1; row++) {
    for (let column = x0; column < x1; column++) {
      const offset = (row * WIDTH + column) * 3;
      canvas[offset] = color[0];
      canvas[offset + 1] = color[1];
      canvas[offset + 2] = color[2];
    }
  }
}

function textWidth(text, scale) {
  return text.length === 0 ? 0 : text.length * 4 * scale - scale;
}

function fitText(text, scale, maxWidth) {
  let value = String(text).toUpperCase().slice(0, 120);
  if (textWidth(value, scale) <= maxWidth) {
    return value;
  }
  while (value.length > 0 && textWidth(`${value}...`, scale) > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

function drawText(canvas, text, x, y, scale, color, maxWidth = WIDTH - x - 60) {
  const value = fitText(text, scale, maxWidth);
  for (let index = 0; index < value.length; index++) {
    const glyph = FONT[value[index]] ?? FONT[" "];
    const originX = x + index * 4 * scale;
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 3; column++) {
        if (glyph[row] & (1 << (2 - column))) {
          fillRect(canvas, originX + column * scale, y + row * scale, scale, scale, color);
        }
      }
    }
  }
}

function encodePng(canvas) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = 1 + WIDTH * 3;
  const raw = Buffer.alloc(HEIGHT * stride);
  for (let row = 0; row < HEIGHT; row++) {
    canvas.copy(raw, row * stride + 1, row * WIDTH * 3, (row + 1) * WIDTH * 3);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function sanitizeReferralField(value, maxLength, fallback = "") {
  const printable = String(value ?? "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const cleaned = printable.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return cleaned || fallback;
}

export function renderReferralCard({ name, earnings, ref }) {
  const canvas = Buffer.alloc(WIDTH * HEIGHT * 3);
  fillRect(canvas, 0, 0, WIDTH, HEIGHT, COLORS.background);
  fillRect(canvas, 0, 0, WIDTH, 12, COLORS.accent);
  fillRect(canvas, 60, 118, 1080, 2, COLORS.panel);
  fillRect(canvas, 60, 445, 1080, 2, COLORS.panel);
  drawText(canvas, "IPREDICT REFERRALS", 60, 48, 10, COLORS.accent);
  drawText(canvas, "PLAYER", 60, 155, 4, COLORS.muted);
  drawText(canvas, name, 60, 195, 9, COLORS.text);
  drawText(canvas, "REFERRAL EARNINGS", 60, 295, 4, COLORS.muted);
  drawText(canvas, `${earnings} XLM`, 60, 335, 11, COLORS.success);
  drawText(canvas, "JOIN WITH MY CODE", 60, 475, 4, COLORS.muted);
  drawText(canvas, ref, 60, 515, 5, COLORS.text);
  drawText(canvas, "EARN 0.5% ON EVERY FRIEND'S BET", 60, 580, 3, COLORS.muted);
  return encodePng(canvas);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderReferralMeta({ name, earnings, ref, appUrl, imageUrl }) {
  const title = `${name} invites you to iPredict`;
  const description =
    `Join ${name} on iPredict and earn 0.5% on every friend's bet. ` +
    `Referral earnings so far: ${earnings} XLM.`;
  const redirect = JSON.stringify(appUrl).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(appUrl)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(imageUrl)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}">
</head>
<body>
<p>Opening iPredict referral for ${escapeHtml(ref)}&hellip;
<a href="${escapeHtml(appUrl)}">Continue</a></p>
<script>window.location.replace(${redirect});</script>
</body>
</html>`;
}

const fs = require('node:fs/promises');

// The VP8X animation flag is in the first 30 bytes, even with large EXIF/ICC
// payloads. Inspect the signature, not the filename (imports may lack a suffix).
// https://developers.google.com/speed/webp/docs/riff_container#extended_file_format
function animatedWebP(header) {
  return header.length >= 30 && header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 16) === 'WEBPVP8X' &&
    header.readUInt32LE(16) >= 10 && (header[20] & 0x02) !== 0;
}

async function imageAnimation(file) {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(30);
    const {bytesRead} = await handle.read(header, 0, header.length, 0);
    return {animated: animatedWebP(header.subarray(0, bytesRead))};
  } finally {await handle.close();}
}

module.exports = {animatedWebP, imageAnimation};

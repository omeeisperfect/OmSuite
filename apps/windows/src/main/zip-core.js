// OmSuite Windows — pure ZIP core (no Electron import, no deps).
// Node zlib for deflate; manual local headers + central directory; CRC32.
// Supports stored (method 0) and deflate (method 8) entries. Encrypted
// entries (flag bit 0) and multi-disk archives are refused, not guessed.

const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const day = ((Math.max(0, d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date: day };
}

// entries: [{ name, data: Buffer|string, method?: 0|8 }]. Names use '/' separators.
function createZip(entries) {
  const list = entries || [];
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of list) {
    const nameBuf = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const method = entry.method === 0 ? 0 : 8;
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const { time, date } = dosDateTime(entry.date);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); // extra
    cen.writeUInt16LE(0, 32); // comment
    cen.writeUInt16LE(0, 34); // disk
    cen.writeUInt16LE(0, 36); // internal attrs
    cen.writeUInt32LE(0, 38); // external attrs
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(list.length, 8);
  eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

function findEocd(buf) {
  // EOCD is in the last 64 KiB + 22 bytes; scan backwards for its signature.
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function listZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const eocd = findEocd(buf);
  if (eocd === -1) throw new Error('Not a ZIP file: end-of-central-directory record not found.');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('ZIP central directory is damaged at entry ' + n + '.');
    }
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, flags, crc, compressedSize: compSize, size, localOffset, encrypted: (flags & 1) === 1 });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Read + decompress one entry (from listZip). Verifies CRC.
function readEntry(buffer, entry) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (entry.encrypted) throw new Error('Encrypted ZIP entry is not supported: ' + entry.name);
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('ZIP local header missing for: ' + entry.name);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const comp = buf.subarray(dataStart, dataStart + entry.compressedSize);
  let data;
  if (entry.method === 0) data = Buffer.from(comp);
  else if (entry.method === 8) data = zlib.inflateRawSync(comp);
  else throw new Error('Unsupported ZIP compression method ' + entry.method + ' for: ' + entry.name);
  if (crc32(data) !== entry.crc) throw new Error('CRC mismatch for ZIP entry: ' + entry.name);
  return data;
}

// Full extract: returns [{ name, data }]; skips directory entries.
function extractZip(buffer) {
  const entries = listZip(buffer);
  const out = [];
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    out.push({ name: e.name, data: readEntry(buffer, e) });
  }
  return out;
}

module.exports = { crc32, createZip, listZip, readEntry, extractZip };

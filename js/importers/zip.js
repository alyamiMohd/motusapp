// A small zip reader for exports (Apple Health's export.zip, MyFitnessPal's emailed zip), with no library.
// It reads the central directory, then streams one entry through the browser's own DecompressionStream, so a
// multi-gigabyte export.xml is never held in memory at once. Supports ZIP64 (large Apple Health exports).

const u16 = (v, o) => v.getUint16(o, true), u32 = (v, o) => v.getUint32(o, true);
const u64 = (v, o) => Number(v.getBigUint64(o, true));
const bytes = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer());

export async function listEntries(blob) {
  const tailLen = Math.min(blob.size, 65557 + 20);
  const tailStart = blob.size - tailLen, tail = await bytes(blob, tailStart, blob.size);
  let p = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { p = i; break; }
  if (p < 0) throw new Error("This doesn't look like a zip file.");
  let count = u16(tail, p + 10), cdSize = u32(tail, p + 12), cdOffset = u32(tail, p + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {          // ZIP64
    if (p < 20 || u32(tail, p - 20) !== 0x07064b50) throw new Error("Unsupported zip file.");
    const z = await bytes(blob, u64(tail, p - 12), u64(tail, p - 12) + 56);
    if (u32(z, 0) !== 0x06064b50) throw new Error("Unsupported zip file.");
    count = u64(z, 32); cdSize = u64(z, 40); cdOffset = u64(z, 48);
  }
  const cd = await bytes(blob, cdOffset, cdOffset + cdSize), out = [], dec = new TextDecoder();
  for (let i = 0, o = 0; i < count && o + 46 <= cdSize; i++) {
    if (u32(cd, o) !== 0x02014b50) break;
    const method = u16(cd, o + 10), nameLen = u16(cd, o + 28), extraLen = u16(cd, o + 30), commentLen = u16(cd, o + 32);
    let compSize = u32(cd, o + 20), size = u32(cd, o + 24), offset = u32(cd, o + 42);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nameLen));
    for (let e = o + 46 + nameLen; e + 4 <= o + 46 + nameLen + extraLen;) {           // ZIP64 extra field
      const id = u16(cd, e), len = u16(cd, e + 2);
      if (id === 0x0001) {
        let f = e + 4;
        if (size === 0xffffffff) { size = u64(cd, f); f += 8; }
        if (compSize === 0xffffffff) { compSize = u64(cd, f); f += 8; }
        if (offset === 0xffffffff) { offset = u64(cd, f); }
      }
      e += 4 + len;
    }
    out.push({ name, method, compSize, size, offset });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// The entry's uncompressed bytes as a stream. onBytes(n) reports compressed bytes read, for a progress bar.
export async function entryStream(blob, entry, onBytes) {
  const h = await bytes(blob, entry.offset, entry.offset + 30);
  if (u32(h, 0) !== 0x04034b50) throw new Error("Damaged zip file.");
  const start = entry.offset + 30 + u16(h, 26) + u16(h, 28);
  let raw = blob.slice(start, start + entry.compSize).stream();
  if (onBytes) raw = raw.pipeThrough(new TransformStream({ transform(c, ctl) { onBytes(c.byteLength); ctl.enqueue(c); } }));
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error("Unsupported compression in this zip file.");
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open zip files. Update it, or unzip the file and choose what's inside.");
  return raw.pipeThrough(new DecompressionStream("deflate-raw"));
}

export async function entryText(blob, entry) {
  return new Response(await entryStream(blob, entry)).text();
}

export const isZip = async file => file.size >= 4 && u32(await bytes(file, 0, 4), 0) === 0x04034b50;

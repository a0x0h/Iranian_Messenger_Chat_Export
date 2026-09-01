/* Minimal store-only (uncompressed) ZIP writer used by the exporter.
   Store-only keeps the code tiny and avoids a compression dependency; media
   files are already compressed, so the size cost is limited to text entries. */
(function (global) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();

  const crc32 = bytes => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const u16 = n => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const u32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const join = parts => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };

  const dosTime = date => ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = date => (((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

  const MAX_ARCHIVE_BYTES = 0xffffffff; // ZIP64 is not implemented; keep archives under 4 GiB.

  class ZipStore {
    constructor() { this.files = []; this.bytes = 0; this.stamp = new Date(); }

    get size() { return this.bytes; }

    /** Returns false when the entry would push the archive past the 4 GiB ZIP limit. */
    add(name, data) {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const path = String(name).replace(/\\/g, "/").replace(/^\/+/, "");
      if (this.bytes + bytes.length > MAX_ARCHIVE_BYTES) return false;
      this.files.push({ name: path, bytes });
      this.bytes += bytes.length;
      return true;
    }

    blob() {
      const encoder = new TextEncoder();
      const time = u16(dosTime(this.stamp));
      const date = u16(dosDate(this.stamp));
      const locals = [];
      const centrals = [];
      let offset = 0;
      for (const file of this.files) {
        const name = encoder.encode(file.name);
        const crc = crc32(file.bytes);
        const size = u32(file.bytes.length);
        const header = join([u32(0x04034b50), u16(20), u16(0x800), u16(0), time, date, u32(crc), size, size, u16(name.length), u16(0), name]);
        locals.push(header, file.bytes);
        centrals.push(join([u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(0), time, date, u32(crc), size, size,
          u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
        offset += header.length + file.bytes.length;
      }
      const central = join(centrals);
      const end = join([u32(0x06054b50), u16(0), u16(0), u16(this.files.length), u16(this.files.length), u32(central.length), u32(offset), u16(0)]);
      return new Blob([...locals, central, end], { type: "application/zip" });
    }
  }

  global.BaleZipStore = ZipStore;
})(globalThis);

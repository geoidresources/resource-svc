// Store-only (method 0) ZIP writer that streams: bytes are handed to the sink as
// they arrive and never held whole in memory. Geospatial payloads here are laz,
// png and jpeg, all already compressed, so deflate would cost CPU for nothing.
//
// Sizes and CRC are only known once an entry's bytes have passed through, so every
// entry sets the data-descriptor flag and writes them afterwards. ZIP64 records are
// emitted per entry when it exceeds 4 GiB, and for the archive when it ends up with
// more than 65535 entries or crosses the 4 GiB offset ceiling.

const LOCAL_SIG = 0x04034b50;
const DESCRIPTOR_SIG = 0x08074b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

// Bit 3: sizes and CRC follow the data. Bit 11: names are UTF-8.
const FLAGS = 0x0008 | 0x0800;
const VERSION_PLAIN = 20;
const VERSION_ZIP64 = 45;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export class Crc32 {
  private state = 0xffffffff;

  update(bytes: Uint8Array<ArrayBuffer>): void {
    let c = this.state;
    for (let i = 0; i < bytes.length; i++)
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    this.state = c;
  }

  get value(): number {
    return (this.state ^ 0xffffffff) >>> 0;
  }
}

class Builder {
  private bytes: number[] = [];

  u16(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }

  u32(v: number): this {
    this.bytes.push(
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff,
    );
    return this;
  }

  u64(v: number): this {
    const big = BigInt(v);
    for (let i = 0n; i < 8n; i++)
      this.bytes.push(Number((big >> (i * 8n)) & 0xffn));
    return this;
  }

  raw(bytes: Uint8Array<ArrayBuffer>): this {
    for (const b of bytes) this.bytes.push(b);
    return this;
  }

  done(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.bytes);
  }
}

// MS-DOS packed date/time: two-second resolution, epoch 1980.
function dosTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function encodeName(path: string): Uint8Array<ArrayBuffer> {
  const clean = path
    .split("/")
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .join("/");
  return new TextEncoder().encode(clean);
}

interface CentralEntry {
  name: Uint8Array<ArrayBuffer>;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
  zip64: boolean;
}

export interface ZipEntry {
  path: string;
  size: number;
  modified?: Date | null;
}

export class ZipWriter {
  private entries: CentralEntry[] = [];
  private offset = 0;
  private names = new Set<string>();

  constructor(
    private readonly sink: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>,
  ) {}

  private async push(chunk: Uint8Array<ArrayBuffer>): Promise<void> {
    this.offset += chunk.length;
    await this.sink(chunk);
  }

  // Two objects in one bucket prefix can differ only by a character the local
  // filesystem folds away, and a zip with duplicate names silently loses one.
  private uniqueName(path: string): string {
    let candidate = path;
    for (let n = 2; this.names.has(candidate.toLowerCase()); n++) {
      const slash = path.lastIndexOf("/");
      const dir = slash === -1 ? "" : path.slice(0, slash + 1);
      const base = path.slice(slash + 1);
      const dot = base.lastIndexOf(".");
      candidate =
        dot <= 0
          ? `${dir}${base} (${n})`
          : `${dir}${base.slice(0, dot)} (${n})${base.slice(dot)}`;
    }
    this.names.add(candidate.toLowerCase());
    return candidate;
  }

  async add(
    entry: ZipEntry,
    body: ReadableStream<Uint8Array<ArrayBuffer>>,
    onProgress?: (received: number) => void,
  ): Promise<void> {
    const name = encodeName(this.uniqueName(entry.path));
    if (name.length === 0)
      throw new Error(`cannot store an entry named ${entry.path}`);
    const zip64 = entry.size >= U32_MAX;
    const stamp = dosTime(entry.modified ?? new Date());
    const offset = this.offset;

    const header = new Builder()
      .u32(LOCAL_SIG)
      .u16(zip64 ? VERSION_ZIP64 : VERSION_PLAIN)
      .u16(FLAGS)
      .u16(0)
      .u16(stamp.time)
      .u16(stamp.date)
      .u32(0)
      .u32(0)
      .u32(0)
      .u16(name.length)
      .u16(zip64 ? 20 : 0)
      .raw(name);
    if (zip64) {
      header.u16(ZIP64_EXTRA_ID).u16(16).u64(0).u64(0);
    }
    await this.push(header.done());

    const crc = new Crc32();
    let received = 0;
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        crc.update(value);
        received += value.length;
        await this.push(value);
        onProgress?.(received);
      }
    } finally {
      reader.releaseLock();
    }

    const descriptor = new Builder().u32(DESCRIPTOR_SIG).u32(crc.value);
    if (zip64) descriptor.u64(received).u64(received);
    else descriptor.u32(received).u32(received);
    await this.push(descriptor.done());

    this.entries.push({
      name,
      crc: crc.value,
      size: received,
      offset,
      time: stamp.time,
      date: stamp.date,
      // An entry declared under 4 GiB that arrives larger still needs ZIP64 in the
      // central directory, even though its local header was written without it.
      zip64: zip64 || received >= U32_MAX,
    });
  }

  async finish(): Promise<void> {
    const centralStart = this.offset;

    for (const e of this.entries) {
      const bigOffset = e.offset >= U32_MAX;
      const extra = new Builder();
      if (e.zip64) extra.u64(e.size).u64(e.size);
      if (bigOffset) extra.u64(e.offset);
      const extraBody = extra.done();
      const extraLength = extraBody.length > 0 ? extraBody.length + 4 : 0;

      const central = new Builder()
        .u32(CENTRAL_SIG)
        .u16((3 << 8) | VERSION_ZIP64)
        .u16(e.zip64 || bigOffset ? VERSION_ZIP64 : VERSION_PLAIN)
        .u16(FLAGS)
        .u16(0)
        .u16(e.time)
        .u16(e.date)
        .u32(e.crc)
        .u32(e.zip64 ? U32_MAX : e.size)
        .u32(e.zip64 ? U32_MAX : e.size)
        .u16(e.name.length)
        .u16(extraLength)
        .u16(0)
        .u16(0)
        .u16(0)
        // "version made by" claims Unix, so the high half of the external attributes
        // is read as st_mode; leaving it zero extracts every file as mode 0000.
        .u32(0o644 << 16)
        .u32(bigOffset ? U32_MAX : e.offset)
        .raw(e.name);
      if (extraLength > 0)
        central.u16(ZIP64_EXTRA_ID).u16(extraBody.length).raw(extraBody);
      await this.push(central.done());
    }

    const centralSize = this.offset - centralStart;
    const needsZip64 =
      this.entries.length > U16_MAX ||
      centralStart >= U32_MAX ||
      centralSize >= U32_MAX;

    if (needsZip64) {
      const zip64End = this.offset;
      await this.push(
        new Builder()
          .u32(ZIP64_EOCD_SIG)
          .u64(44)
          .u16((3 << 8) | VERSION_ZIP64)
          .u16(VERSION_ZIP64)
          .u32(0)
          .u32(0)
          .u64(this.entries.length)
          .u64(this.entries.length)
          .u64(centralSize)
          .u64(centralStart)
          .done(),
      );
      await this.push(
        new Builder().u32(ZIP64_LOCATOR_SIG).u32(0).u64(zip64End).u32(1).done(),
      );
    }

    await this.push(
      new Builder()
        .u32(EOCD_SIG)
        .u16(0)
        .u16(0)
        .u16(Math.min(this.entries.length, U16_MAX))
        .u16(Math.min(this.entries.length, U16_MAX))
        .u32(Math.min(centralSize, U32_MAX))
        .u32(Math.min(centralStart, U32_MAX))
        .u16(0)
        .done(),
    );
  }
}

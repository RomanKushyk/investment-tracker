// Builds the ZIP container an .xlsx is, for tests. The provider's files are
// real financial data and never committed, so the workbook under test is
// assembled from committed XML parts at run time.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/**
 * A ZIP archive holding `entries`, every one compressed with `method`:
 * 8 (deflate, what Excel writes), 0 (stored), or any other number to build an
 * archive a reader must refuse.
 */
export function zipOf(entries: Record<string, string | Uint8Array>, method = 8): Uint8Array {
  const locals: number[] = [];
  const central: number[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = [...Buffer.from(name, 'utf8')];
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const stored = method === 0 ? data : deflateRawSync(data);
    const crc = crc32(data);
    const offset = locals.length;
    locals.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(stored.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...stored,
    );
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(stored.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );
  }
  const count = Object.keys(entries).length;
  const eocd = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(count),
    ...u16(count),
    ...u32(central.length),
    ...u32(locals.length),
    ...u16(0),
  ];
  return Uint8Array.from([...locals, ...central, ...eocd]);
}

const FUND_HISTORY_DIR = new URL('./fund-history/', import.meta.url);

/** The committed parts of the synthetic fund-history workbook, by zip path. */
export function fundHistoryParts(): Record<string, string> {
  const part = (file: string) => readFileSync(new URL(file, FUND_HISTORY_DIR), 'utf8');
  return {
    'xl/workbook.xml': part('workbook.xml'),
    'xl/_rels/workbook.xml.rels': part('workbook.xml.rels'),
    'xl/sharedStrings.xml': part('sharedStrings.xml'),
    'xl/worksheets/sheet1.xml': part('sheet1.xml'),
    'xl/worksheets/sheet2.xml': part('sheet2.xml'),
  };
}

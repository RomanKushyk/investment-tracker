// A reader for the one workbook shape the provider publishes: a ZIP of
// Excel-written XML parts holding numbers, shared strings and cached formula
// results. It is here instead of a package because every spreadsheet library
// reads a text cell as a number when it can, and that tolerant cast is exactly
// the defect the fund-history import must refuse. [The price archive]
import { inflateRawSync } from 'node:zlib';

/** A cell is a number or a string; the reader never converts between them. */
export interface XlsxCell {
  n?: number;
  s?: string;
}

/** Row number → column letters → cell. Only cells carrying a value appear. */
export interface XlsxSheet {
  name: string;
  rows: Map<number, Map<string, XlsxCell>>;
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
}

const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DEFLATE = 8;
const STORED = 0;

/** Every entry of a ZIP archive, decompressed, keyed by its path. */
export function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no end-of-central-directory record');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL_DIRECTORY) {
      throw new Error('zip: central directory entry expected');
    }
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = Buffer.from(bytes.subarray(at + 46, at + 46 + nameLength)).toString('utf8');
    // The local header repeats the name and carries its own extra field, so
    // the data offset is read from it rather than assumed.
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const stored = bytes.subarray(data, data + compressed);
    if (method === DEFLATE) out.set(name, new Uint8Array(inflateRawSync(stored)));
    else if (method === STORED) out.set(name, stored);
    else throw new Error(`zip: unsupported method ${method} for ${name}`);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, entity: string) => {
    switch (entity.toLowerCase()) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(
          entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)),
        );
    }
  });
}

function attribute(attributes: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  if (!m) throw new Error(`xlsx: attribute ${name} missing in <${attributes.trim()}>`);
  return decodeEntities(m[1]);
}

/**
 * The shared-string table in index order; a rich-text string is its runs
 * joined. An empty entry still takes its index, or every string after it
 * would resolve one place off — the reader's one route to a wrong value
 * rather than a refusal.
 */
export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b(?:\/>|[^>]*>([\s\S]*?)<\/si>)/g)].map((si) =>
    [...(si[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeEntities(t[1]))
      .join(''),
  );
}

/**
 * The cells of one worksheet part. A cell without a cached value is absent;
 * a type this reader does not know is refused by address, never skipped.
 */
export function sheetCells(xml: string, sst: string[], sheet: string): XlsxSheet['rows'] {
  const rows = new Map<number, Map<string, XlsxCell>>();
  for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, column, rowText, attributes, inner = ''] = c;
    const at = `${sheet}!${column}${rowText}`;
    const type = /\bt="([^"]*)"/.exec(attributes)?.[1];
    // The type is judged before the value: an inline string carries no <v>,
    // and skipping it would turn a text price into a missing one.
    if (type !== undefined && type !== 'n' && type !== 's' && type !== 'str') {
      throw new Error(`xlsx: unsupported cell type "${type}" at ${at}`);
    }
    const value = /<v>([\s\S]*?)<\/v>/.exec(inner);
    if (!value) continue;
    let cell: XlsxCell;
    if (type === undefined || type === 'n') {
      const n = Number(value[1]);
      if (value[1].trim() === '' || !Number.isFinite(n)) {
        throw new Error(`xlsx: unreadable number "${value[1]}" at ${at}`);
      }
      cell = { n };
    } else if (type === 's') {
      const index = /^\d+$/.test(value[1]) ? Number(value[1]) : -1;
      const s = sst[index];
      if (s === undefined) throw new Error(`xlsx: shared string "${value[1]}" missing at ${at}`);
      cell = { s };
    } else {
      cell = { s: decodeEntities(value[1]) };
    }
    const row = Number(rowText);
    let cells = rows.get(row);
    if (!cells) {
      cells = new Map();
      rows.set(row, cells);
    }
    cells.set(column, cell);
  }
  return rows;
}

/** The workbook's sheets in its own order, each read through `sheetCells`. */
export function readXlsx(bytes: Uint8Array): XlsxWorkbook {
  const parts = zipEntries(bytes);
  const part = (name: string) => {
    const p = parts.get(name);
    if (!p) throw new Error(`xlsx: part ${name} missing`);
    return Buffer.from(p).toString('utf8');
  };
  const targets = new Map(
    [...part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/>/g)].map((r) => [
      attribute(r[1], 'Id'),
      attribute(r[1], 'Target'),
    ]),
  );
  const sstPart = parts.get('xl/sharedStrings.xml');
  const sst = sstPart ? sharedStrings(Buffer.from(sstPart).toString('utf8')) : [];
  const sheets = [...part('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/>/g)].map((s) => {
    const name = attribute(s[1], 'name');
    const id = attribute(s[1], 'r:id');
    const target = targets.get(id);
    if (!target) throw new Error(`xlsx: sheet "${name}" points at unknown relationship ${id}`);
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    return { name, rows: sheetCells(part(path), sst, name) };
  });
  return { sheets };
}

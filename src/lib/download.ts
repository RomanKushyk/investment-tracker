// Handing a generated file to the user (*Persistence today*). Browser APIs, so
// src/lib and never the domain package.
//
// Two paths, same bytes and same suggested name: `showSaveFilePicker` where it
// exists, `<a download>` everywhere else. Cancelling the Save-as dialog is not an
// error. THE PRE-IMPORT SAFETY BACKUP ALWAYS PASSES `via: 'anchor'` — a guarantee
// behind a dialog the user can cancel is not a guarantee.

/** `'cancelled'` = the user dismissed the picker. A real failure THROWS. */
export type SaveOutcome = 'saved' | 'cancelled';

export interface SaveTextOptions {
  mime: string;
  /** `'anchor'` forces the non-cancellable path (the safety backup). */
  via?: 'picker' | 'anchor';
}

// Declared here rather than taken from lib.dom, whose File System Access coverage
// varies by TS version, and never as globals, so nothing clashes with the platform.
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
interface WritableFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  createWritable(): Promise<WritableFile>;
}
type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

function savePicker(): SaveFilePicker | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
}

export async function saveTextFile(
  name: string,
  text: string,
  opts: SaveTextOptions,
): Promise<SaveOutcome> {
  const picker = opts.via === 'anchor' ? undefined : savePicker();
  if (picker) {
    let handle: SaveFileHandle;
    try {
      handle = await picker({
        suggestedName: name,
        types: [{ accept: { [opts.mime]: [extensionOf(name)] } }],
      });
    } catch (error) {
      if ((error as Error | undefined)?.name === 'AbortError') return 'cancelled';
      // No user activation left, or a sandboxed context: fall back rather than cost the
      // user the export.
      return anchorDownload(name, text, opts.mime);
    }
    const writable = await handle.createWritable(); // truncates by default
    await writable.write(new Blob([text], { type: opts.mime }));
    await writable.close();
    return 'saved';
  }
  return anchorDownload(name, text, opts.mime);
}

function anchorDownload(name: string, text: string, mime: string): SaveOutcome {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return 'saved';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

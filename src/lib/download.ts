// Handing a generated file to the user (DECISIONS D29). Infra, not domain:
// `showSaveFilePicker`, Blob and the anchor click are browser APIs and
// therefore live in src/lib, never in src/core (G1) — alongside `sync.ts`, the
// other browser-API module.
//
// SAVE-PICKER PARITY (S5, pinned): where `showSaveFilePicker` exists (Chromium)
// an export opens the browser's Save-as dialog; everywhere else the file lands
// in Downloads through `<a download>`. The two paths produce the SAME bytes and
// the same suggested name, the UI never mentions which one ran, and
// **cancelling the Save-as dialog is not an error** — `AbortError` resolves as
// `'cancelled'`: no toast, no message, nothing written.
//
// The ONE exception, and it is a hard rule (D24): the pre-import safety backup
// always passes `via: 'anchor'`. A modal Save-as dialog in front of a safety
// guarantee is a dialog the user can cancel, and that guarantee must not be
// cancellable.

/** `'cancelled'` = the user dismissed the picker. A real failure THROWS. */
export type SaveOutcome = 'saved' | 'cancelled';

export interface SaveTextOptions {
  mime: string;
  /** `'anchor'` forces the non-cancellable path (the safety backup). */
  via?: 'picker' | 'anchor';
}

// Minimal local shapes for the File System Access API — declared here rather
// than relied on from lib.dom (its coverage varies by TS version), and never as
// globals, so nothing clashes with the platform types.
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
      // A cancelled picker is a decision, not a failure.
      if ((error as Error | undefined)?.name === 'AbortError') return 'cancelled';
      // Anything else (no user activation left, a sandboxed context) must not
      // cost the user the export: fall back to the path that always works.
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

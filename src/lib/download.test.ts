// The save paths, against a FAKE file handle. An automated browser cannot
// drive a native OS file picker, so this is where the `showSaveFilePicker`
// branch is actually verified: the bytes handed to the handle, the silent
// AbortError on cancel, and the anchor fallback.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveTextFile } from './download';

interface Written {
  name?: string;
  bytes: string;
  closed: boolean;
}

interface PickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

/** A picker that resolves to a handle recording what was written to it. */
function fakePicker(written: Written) {
  return vi.fn(async (options?: PickerOptions) => {
    written.name = options?.suggestedName;
    return {
      createWritable: () =>
        Promise.resolve({
          write: async (blob: Blob) => {
            written.bytes = await blob.text();
          },
          close: () => {
            written.closed = true;
            return Promise.resolve();
          },
        }),
    };
  });
}

interface AnchorSpy {
  href?: string;
  download?: string;
  clicks: number;
}

/** The `<a download>` path needs a document and object URLs; node has neither. */
function stubAnchor(): AnchorSpy {
  const spy: AnchorSpy = { clicks: 0 };
  const anchor = {
    set href(value: string) {
      spy.href = value;
    },
    set download(value: string) {
      spy.download = value;
    },
    click: () => {
      spy.clicks += 1;
    },
  };
  vi.stubGlobal('document', { createElement: () => anchor });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined });
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveTextFile', () => {
  it('uses the Save-as picker where it exists, with the suggested name and the exact bytes', async () => {
    const written: Written = { bytes: '', closed: false };
    const picker = fakePicker(written);
    vi.stubGlobal('window', { showSaveFilePicker: picker });

    const outcome = await saveTextFile('quirenote-snapshots-2026-08-04.csv', 'date,cash\r\n', {
      mime: 'text/csv',
    });

    expect(outcome).toBe('saved');
    expect(written.name).toBe('quirenote-snapshots-2026-08-04.csv');
    expect(written.bytes).toBe('date,cash\r\n');
    expect(written.closed).toBe(true); // a stream left open writes nothing
    expect(picker.mock.calls[0][0]?.types).toEqual([{ accept: { 'text/csv': ['.csv'] } }]);
  });

  it('treats a cancelled picker as a decision, not an error', async () => {
    const abort = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    vi.stubGlobal('window', { showSaveFilePicker: () => Promise.reject(abort) });
    const anchor = stubAnchor();

    await expect(saveTextFile('x.csv', 'a', { mime: 'text/csv' })).resolves.toBe('cancelled');
    // Nothing else happens: no fallback download behind the user's back.
    expect(anchor.clicks).toBe(0);
  });

  it('falls back to <a download> when the picker fails for any other reason', async () => {
    const denied = Object.assign(new Error('Must be handling a user gesture'), {
      name: 'SecurityError',
    });
    vi.stubGlobal('window', { showSaveFilePicker: () => Promise.reject(denied) });
    const anchor = stubAnchor();

    await expect(saveTextFile('x.csv', 'a', { mime: 'text/csv' })).resolves.toBe('saved');
    expect(anchor.clicks).toBe(1);
    expect(anchor.download).toBe('x.csv');
  });

  it('uses <a download> where no picker exists (Firefox, Safari)', async () => {
    vi.stubGlobal('window', {});
    const anchor = stubAnchor();

    await expect(
      saveTextFile('quirenote-backup-2026-08-04.json', '{}', {
        mime: 'application/json',
      }),
    ).resolves.toBe('saved');
    expect(anchor.download).toBe('quirenote-backup-2026-08-04.json');
    expect(anchor.href).toBe('blob:fake');
  });

  it('forces the anchor when asked — the safety backup must not be cancellable', async () => {
    const written: Written = { bytes: '', closed: false };
    const picker = fakePicker(written);
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    const anchor = stubAnchor();

    await expect(
      saveTextFile('quirenote-before-import-2026-08-04.json', '{}', {
        mime: 'application/json',
        via: 'anchor',
      }),
    ).resolves.toBe('saved');
    expect(picker).not.toHaveBeenCalled();
    expect(anchor.clicks).toBe(1);
  });
});

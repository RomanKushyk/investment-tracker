import type { Plugin } from 'vite';

// `'strict-dynamic'` refuses the build's parser-inserted entry tag, so one inline module whose hash
// the policy names creates it instead; `import()` from it would inherit "parser-inserted" too.
export const LOADER =
  "const s=document.createElement('script');s.type='module';s.src=document.getElementById('entry').dataset.src;document.head.append(s)";

const ENTRY = /<script type="module" crossorigin src="([^"]+)"><\/script>/g;

/** The built page with its one entry tag replaced by the loader, inline and deferred like the tag. */
export function loadEntry(html: string): string {
  const tags = [...html.matchAll(ENTRY)];
  if (tags.length !== 1) throw new Error(`expected one entry tag, found ${tags.length}`);
  return html.replace(
    ENTRY,
    (_, src: string) => `<script type="module" id="entry" data-src="${src}">${LOADER}</script>`,
  );
}

export function entryLoader(): Plugin {
  return {
    name: 'entry-loader',
    // The dev server serves the source tag, and the policy is the deployed host's.
    apply: 'build',
    // After Vite's own tags are in place, which `post` is.
    transformIndexHtml: { order: 'post', handler: loadEntry },
  };
}

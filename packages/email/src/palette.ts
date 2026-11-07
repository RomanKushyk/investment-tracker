// Mail cannot read a CSS custom property, so the tokens the layout paints are copied here;
// email.test.ts holds every entry to src/index.css, and no other file of the package writes a hex.
export const PALETTE = {
  light: {
    page: '#efeae2',
    card: '#f8f5ef',
    hairline: '#ddd5c8',
    ink: '#1c1a19',
    muted: '#5e5955',
    panel: '#e7e0d5',
    accent: '#8a5a3a',
    'accent-fg': '#f8f5ef',
  },
  dark: {
    page: '#111110',
    card: '#19181a',
    hairline: '#2a282c',
    ink: '#eceae7',
    muted: '#a3a19e',
    panel: '#201f22',
    accent: '#d8b494',
    'accent-fg': '#1c1a19',
  },
} as const;

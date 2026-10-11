import type { CSSProperties, ReactNode } from 'react';

// THE PIECES OF THE FIRST-PAINT LOADING STATE (design/extensions/first-paint.dc.html). Every one is
// decoration: hidden from assistive technology, interactive in nothing, and drawn in the tokens the
// real screen is. A block takes `panel` on a card and `card` on a tinted surface; it is no component
// boundary, so the 3 : 1 rule does not bind it, and meaning goes through the status line.

/** The app's pulse, 1.2 s as the import dialog's busy states run it. Under reduced motion the global
 *  kill switch in `index.css` leaves it still. */
const PULSE = 'animate-pulse [animation-duration:1.2s]';

type Tone = 'panel' | 'card';
const TONE: Record<Tone, string> = { panel: 'bg-panel', card: 'bg-card' };

/** A box held for what is on its way. `kind` names what it holds, for the tests that count them. */
export function Block({
  kind = 'block',
  tone = 'panel',
  className = '',
  style,
}: {
  kind?: string;
  tone?: Tone;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      data-placeholder={kind}
      aria-hidden="true"
      className={`block ${PULSE} ${TONE[tone]} ${className}`}
      style={style}
    />
  );
}

/** A line of text: 12 px at the radius a share bar draws its own. */
export function Bar({ w, tone, className = '' }: { w: string; tone?: Tone; className?: string }) {
  return (
    <Block
      kind="bar"
      tone={tone}
      className={`h-3 rounded-[3px] ${className}`}
      style={{ width: w }}
    />
  );
}

/** «—» in `faint`, at the type size of the figure it stands for. Not announced. */
export function Dash({ className = '' }: { className?: string }) {
  return (
    <span data-dash aria-hidden="true" className={`block text-faint ${className}`}>
      —
    </span>
  );
}

/** The slot a control will fill, held at its size: it is no control, and nothing in it is reachable. */
export function Slot({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div data-placeholder-slot aria-hidden="true" className={className}>
      {children}
    </div>
  );
}

/** A row of a list or a table: a label bar and a figure bar, at the height the real row has. */
export function Row({ tone, className = '' }: { tone?: Tone; className?: string }) {
  return (
    <div data-placeholder-row className={`flex items-center justify-between gap-4 ${className}`}>
      <Bar w="40%" tone={tone} />
      <Bar w="22%" tone={tone} />
    </div>
  );
}

/** Three rows, as a list is held whatever its length will be. */
export function Rows({
  tone,
  className = '',
  rowClassName = '',
}: {
  tone?: Tone;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <div className={className}>
      {[0, 1, 2].map((i) => (
        <Row key={i} tone={tone} className={rowClassName} />
      ))}
    </div>
  );
}

/** The screen while its read is out. It is the busy element, since the live region that speaks is
 *  the layout's and sits outside it; it fades in over 220 ms, and the blocks inside it pulse. */
export function PlaceholderScreen({ children }: { children: ReactNode }) {
  return (
    <div aria-busy="true" className="animate-in duration-220 ease-soft fade-in">
      {children}
    </div>
  );
}

/** The ambient glow and grain behind a shell (shell.md § Backdrop): decorative, so hidden from
 *  assistive tech, and mounted outside anything a route change remounts, so it never moves. */
export function Backdrop() {
  return <div aria-hidden data-backdrop className="glow" />;
}

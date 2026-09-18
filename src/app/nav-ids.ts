/**
 * The two ids `Layout`'s focus handoff moves between. Their own module because
 * neither owner may hold the constant: `AppHeader` importing from the rail and the
 * rail importing back would be a cycle.
 *
 * `NAV_TRIGGER_ID` is on whichever control EXPANDS the navigation — the header's
 * burger below the breakpoint, the rail's own at and above it.
 * `SIDEBAR_COLLAPSE_ID` is on the control that collapses it, in the expanded
 * panel's capital strip.
 *
 * EXACTLY ONE ELEMENT CARRIES EACH, ALWAYS: the rail is mounted only when
 * `desktop` and the header's trigger only when it is not. That is why the header's
 * trigger is conditionally RENDERED and never merely hidden — `getElementById`
 * returns the first match, and a hidden one would take the id from the rail's.
 */
export const NAV_TRIGGER_ID = 'app-nav-trigger';
export const SIDEBAR_COLLAPSE_ID = 'app-sidebar-collapse';

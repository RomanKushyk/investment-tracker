/**
 * The two ids `Layout`'s focus handoff moves between, in a module of their own
 * because #108 split their owners apart.
 *
 * `NAV_TRIGGER_ID` is on whichever control EXPANDS the navigation, and that is
 * two different controls in two shells: below the breakpoint the header's
 * burger opens the drawer, at and above it the rail's own burger expands the
 * rail. `SIDEBAR_COLLAPSE_ID` is on the control that collapses it, in the
 * expanded panel's capital strip. `Layout` looks both up by id on every flip and
 * focuses the one that replaced the one pressed, so neither owner may hold the
 * constant — `AppHeader` importing from the rail and the rail importing back
 * would be a cycle.
 *
 * EXACTLY ONE ELEMENT CARRIES EACH, ALWAYS. `Layout` mounts the rail only when
 * `desktop` and the header's trigger only when it is not, so the two burgers
 * never coexist. That is why the header's trigger must be conditionally
 * RENDERED and never merely hidden: `getElementById` returns the first match,
 * and a hidden one would take the id from the rail's.
 */
export const NAV_TRIGGER_ID = 'app-nav-trigger';
export const SIDEBAR_COLLAPSE_ID = 'app-sidebar-collapse';

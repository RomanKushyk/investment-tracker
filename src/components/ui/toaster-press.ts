/**
 * A PRESS ON A TOAST IS NOT A PRESS OUTSIDE A DIALOG. The toaster takes its own presses under a
 * modal (`AppToaster`), so without this a tap on a toast's close button or action would also
 * dismiss the dialog beneath it. For a Radix `onInteractOutside`.
 */
export function keepOpenForToasts(event: { target: EventTarget | null; preventDefault(): void }) {
  if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) {
    event.preventDefault();
  }
}

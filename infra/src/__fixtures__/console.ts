// What a handler's log lines say, read as Lambda prints them.
import { format } from 'node:util';
import { vi } from 'vitest';

/** An address, not a bare `@`: `format` prints an Error's stack, and a pnpm store path in it
 *  carries `vitest@4.1.11`-shaped segments. A mailbox precedes the `@`; a host that starts with a
 *  letter follows it. */
export const ADDRESS = /[\w.+-]+@[a-z][\w-]*\.[a-z]{2,}/i;

/** How the Node runtime prints an uncaught error: its own enumerable fields spread over its type
 *  and message (`aws-lambda-nodejs-runtime-interface-client`, `src/Errors.js`). */
export const asRuntimePrints = (err: unknown) =>
  JSON.stringify(err, (_k, v: unknown) =>
    v instanceof Error ? Object.assign({ errorType: v.name, errorMessage: v.message }, v) : v,
  );

/** Every level Lambda sends to CloudWatch, read as `format` prints them: JSON writes an Error as
 *  `{}`, dropping a message or a `detail` that carries the address. */
export function watchConsole() {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  return {
    lines: () => spies.flatMap((s) => s.mock.calls.map((call) => format(...(call as unknown[])))),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

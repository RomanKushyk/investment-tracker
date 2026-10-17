// What a query's error may say in a log line: `detail` quotes the refused row, and a class-22
// message quotes the refused value, so neither leaves (*Deployment*).
import { codeOf } from './dsql';

/** A server error as `pg` raises it: a SQLSTATE and the `severity` every server error carries.
 *  `ArchiveReaderRefused` has a code and no severity, so its diagnosis passes whole. */
const fromServer = (err: unknown): err is Error & { code: string } =>
  err instanceof Error &&
  codeOf(err) !== undefined &&
  typeof (err as { severity?: unknown }).severity === 'string';

/** A class-22 message names the value the server refused. */
const quotesValue = (err: { code: string }) => err.code.startsWith('22');

/** The error as a log line may carry it: a server error reduced to its name, SQLSTATE, constraint
 *  and, outside class 22, its message; an Error whose `cause` is one keeps its own message. */
export function loggable(err: unknown): unknown {
  if (fromServer(err)) {
    const constraint = (err as { constraint?: unknown }).constraint;
    return {
      name: err.name,
      code: err.code,
      ...(typeof constraint === 'string' ? { constraint } : {}),
      ...(quotesValue(err) ? {} : { message: err.message }),
    };
  }
  if (err instanceof Error && err.cause !== undefined) {
    const cause = loggable(err.cause);
    if (cause !== err.cause)
      return { name: err.name, message: err.message, stack: err.stack, cause };
  }
  return err;
}

/** The error a handler throws on: the runtime prints an uncaught error's own enumerable fields, so
 *  a server error leaves as a copy with its name and stack and none of them. */
export function rethrowable(err: unknown): unknown {
  if (!fromServer(err)) return err;
  const message = quotesValue(err) ? `the cluster refused a value (${err.code})` : err.message;
  const clean = new Error(message);
  // Defined, not assigned: an assigned `name` is an own enumerable field, which the runtime prints.
  Object.defineProperty(clean, 'name', { value: err.name, configurable: true, writable: true });
  // A function, or `$$` in a dollar-quoted message is expanded as a replacement pattern.
  clean.stack = err.stack?.replace(err.message, () => message);
  return clean;
}

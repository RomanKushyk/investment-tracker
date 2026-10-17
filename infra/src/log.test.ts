// A pg error quotes the refused row in `detail` (`Key (email)=(…)`, `Failing row contains (…)`)
// and, for class 22, the refused value in its message. A handler logs one without either; a
// handler that must still fail the invocation throws a copy without the server's fields.
import { format } from 'node:util';
import { describe, expect, it } from 'vitest';

import { ADDRESS, asRuntimePrints } from './__fixtures__/console';
import { ArchiveReaderRefused } from './dsql';
import { loggable, rethrowable } from './log';

const LEAK = 'leak@quirenote.com';

/** As `pg` raises a unique violation: the fields the server sent, as own enumerable properties. */
const pgError = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "app_user_email_uq"'), {
    name: 'error',
    severity: 'ERROR',
    code: '23505',
    detail: `Key (email)=(${LEAK}) already exists.`,
    schema: 'public',
    table: 'app_user',
    constraint: 'app_user_email_uq',
  });

/** A class-22 refusal, whose message quotes the value. */
const badValue = () =>
  Object.assign(new Error(`invalid input syntax for type uuid: "${LEAK}"`), {
    name: 'error',
    severity: 'ERROR',
    code: '22P02',
  });

describe('loggable', () => {
  it('reduces a pg error to its name, SQLSTATE, constraint and message', () => {
    expect(loggable(pgError())).toEqual({
      name: 'error',
      code: '23505',
      constraint: 'app_user_email_uq',
      message: 'duplicate key value violates unique constraint "app_user_email_uq"',
    });
  });

  it('drops a class-22 message, which quotes the refused value', () => {
    expect(loggable(badValue())).toEqual({ name: 'error', code: '22P02' });
  });

  it('prints no detail and no address, as Lambda formats a line', () => {
    const line = format('approve failed', loggable(pgError()));
    expect(line).toContain('23505');
    expect(line).not.toMatch(/detail/);
    expect(line).not.toMatch(ADDRESS);
    // The control: the raw error prints both.
    expect(format('approve failed', pgError())).toMatch(ADDRESS);
  });

  it('passes anything else through untouched', () => {
    const sdk = Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
    expect(loggable(sdk)).toBe(sdk);
    // Node's errno codes begin with E, a letter no SQLSTATE class begins with.
    const errno = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    expect(loggable(errno)).toBe(errno);
    // A code without a severity is not the server's: the archive refusal's message is the diagnosis.
    const refused = new ArchiveReaderRefused('the archive refused archive_reader (28000)');
    expect(loggable(refused)).toBe(refused);
    expect(loggable('text')).toBe('text');
    expect(loggable(undefined)).toBe(undefined);
  });

  it('reduces a pg error wrapped as a cause, keeping the wrapper', () => {
    const wrapped = new Error('assets: the staging refused a row', { cause: pgError() });
    expect(loggable(wrapped)).toEqual({
      name: 'Error',
      message: 'assets: the staging refused a row',
      stack: wrapped.stack,
      cause: {
        name: 'error',
        code: '23505',
        constraint: 'app_user_email_uq',
        message: pgError().message,
      },
    });
    expect(format(loggable(wrapped))).not.toMatch(ADDRESS);
    // A cause that is not one leaves the wrapper as it is.
    const plain = new Error('outer', { cause: new Error('inner') });
    expect(loggable(plain)).toBe(plain);
  });
});

describe('rethrowable', () => {
  it('keeps the message, name and stack and drops every field the server attached', () => {
    const err = pgError();
    const clean = rethrowable(err) as Error;
    expect(clean).toBeInstanceOf(Error);
    expect(clean).not.toBe(err);
    expect([clean.message, clean.name, clean.stack]).toEqual([err.message, err.name, err.stack]);
    expect(Object.keys(clean)).toEqual([]);
    const printed = asRuntimePrints(clean);
    expect(JSON.parse(printed)).toEqual({ errorType: err.name, errorMessage: err.message });
    expect(printed).not.toMatch(ADDRESS);
    // The control: the runtime's rendering of the raw error carries the address.
    expect(asRuntimePrints(err)).toMatch(ADDRESS);
  });

  it('replaces a class-22 message, in the stack too', () => {
    const clean = rethrowable(badValue()) as Error;
    expect(clean.message).toBe('the cluster refused a value (22P02)');
    expect(clean.stack).not.toMatch(ADDRESS);
    expect(asRuntimePrints(clean)).not.toMatch(ADDRESS);
  });

  // `$$` is plausible SQL, and a string replacement would read it as a pattern.
  it('copies a message holding replacement patterns into the stack as written', () => {
    const err = Object.assign(
      new Error(`unterminated dollar-quoted string at or near "$$abc $'"`),
      {
        name: 'error',
        severity: 'ERROR',
        code: '42601',
      },
    );
    const clean = rethrowable(err) as Error;
    expect(clean.stack).toBe(err.stack);
    expect(clean.stack!.split(/\r?\n/)[0]).toBe(`error: ${err.message}`);
  });

  it('passes anything else through', () => {
    const err = new Error('mode must be one of apply | rehearse');
    expect(rethrowable(err)).toBe(err);
    expect(rethrowable('text')).toBe('text');
  });
});

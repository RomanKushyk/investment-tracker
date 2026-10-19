import { z } from 'zod';

// The policy admits no 'unsafe-eval', and zod's `new Function` probe is reported as a violation
// even though it catches the throw. Read when a schema is built, so this is main.tsx's first import.
z.config({ jitless: true });

# @quirenote/email — the messages the app mails

Each message the app sends, in Ukrainian and English, rendered with React Email to an HTML and a
plain-text part (*Core is pure*). Consumed from source like `@quirenote/core`, and imported by
`infra/`. The design and the copy are `docs/superpowers/specs/2026-11-07-email/`.

```ts
import { render } from '@quirenote/email';

const { subject, preheader, html, text } = await render('invitation', 'uk', {
  origin: 'https://quirenote.com', // the environment's own origin, never one from a request
  email: 'reader@example.com',
  expiresAt, // shown in Kyiv time
});
```

| Module | Holds |
| --- | --- |
| `index.ts` | `render()`, the origin check, the link guard and the text conversion |
| `kinds.tsx` | each kind's params and its content |
| `layout.tsx` | the shared card, header, closing and footer, and the parts: paragraph, credential, action, note |
| `copy.ts` | the signed copy, both languages |
| `palette.ts` | the `src/index.css` tokens mail paints, held to the stylesheet by the tests |

Cognito's kinds (`invitation`, `code`) put `{####}` where Cognito fills the code and must stay under
its 20,000 characters; Cognito sends their HTML alone. A new kind adds its copy, its entry in `KIND`
and its sample in `email.test.ts`.

The mark is `public/email/mark-{light,dark}.png`, written by `scripts/build-touch-icon.mjs`.

import type { Lang } from '@quirenote/core/money';

// The signed copy, from the spec's tables (docs/superpowers/specs/2026-11-07-email/README.md).
// «Ви» is capitalised in mail and lower case in the app (*Voice*).
export const SHARED: Record<Lang, { greeting: string; closing: [string, string]; orOpen: string }> =
  {
    uk: {
      greeting: 'Вітаємо!',
      closing: ['З повагою,', 'команда Quirenote'],
      orOpen: 'Або відкрийте:',
    },
    en: {
      greeting: 'Hello,',
      closing: ['Best regards,', 'The Quirenote team'],
      orOpen: 'Or open:',
    },
  };

const FOOTER_ACCOUNT: Record<Lang, string> = {
  uk: 'Ви отримали цей лист, бо маєте обліковий запис у Quirenote. Якщо маєте запитання, відповідайте на цей лист або пишіть на support@quirenote.com.',
  en: 'You’re receiving this email because you have a Quirenote account. If you have any questions, reply to this email or write to support@quirenote.com.',
};

export const INVITATION = {
  uk: {
    subject: 'Вашу заявку схвалено',
    preheader: (day: string) => `Увійдіть до ${day} з тимчасовим паролем із цього листа.`,
    intro:
      'Дякуємо за інтерес до Quirenote — застосунку для обліку інвестицій: ОВДП, REIT та ін. Ми схвалили Вашу заявку, тож для Вас було створено обліковий запис.',
    address: 'Адреса',
    password: 'Тимчасовий пароль',
    validity: (until: string) =>
      `Тимчасовий пароль діє лише для першого входу — до ${until} за київським часом. Після входу важливо встановити власний пароль.`,
    action: 'Увійти',
    noteLead: 'Не подавали заявку?',
    note: 'Напишіть на support@quirenote.com, і ми видалимо обліковий запис. Ми ніколи не просимо надсилати нам пароль.',
    footer:
      'Ви отримали цей лист, бо з цієї адреси подали заявку на доступ до Quirenote. Якщо маєте запитання, відповідайте на цей лист або пишіть на support@quirenote.com.',
  },
  en: {
    subject: 'Your application is approved',
    preheader: (day: string) => `Sign in by ${day} with the temporary password in this email.`,
    intro:
      'Thank you for your interest in Quirenote, an app for tracking your investments: Ukrainian government bonds, REITs and more. We’ve approved your application, so an account has been created for you.',
    address: 'Address',
    password: 'Temporary password',
    validity: (until: string) =>
      `The temporary password is valid for your first sign-in only, until ${until} Kyiv time. After signing in, it’s important to set your own password.`,
    action: 'Sign in',
    noteLead: 'Didn’t apply?',
    note: 'Write to support@quirenote.com, and we’ll delete the account. We never ask you to send us a password.',
    footer:
      'You’re receiving this email because an application to Quirenote was made with this address. If you have any questions, reply to this email or write to support@quirenote.com.',
  },
} satisfies Record<Lang, unknown>;

export const CODE = {
  uk: {
    subject: 'Ваш код підтвердження',
    preheader: 'Введіть його в Quirenote, щоб продовжити.',
    intro: 'Введіть цей код у Quirenote, щоб продовжити.',
    code: 'Код',
    noteLead: 'Не запитували код?',
    note: 'Просто проігноруйте цей лист — нічого не зміниться. Якщо такі листи надходитимуть знову, напишіть на support@quirenote.com.',
    footer: FOOTER_ACCOUNT.uk,
  },
  en: {
    subject: 'Your verification code',
    preheader: 'Enter it in Quirenote to continue.',
    intro: 'Enter this code in Quirenote to continue.',
    code: 'Code',
    noteLead: 'Didn’t request a code?',
    note: 'You can ignore this email; nothing will change. If you keep receiving them, write to support@quirenote.com.',
    footer: FOOTER_ACCOUNT.en,
  },
} satisfies Record<Lang, unknown>;

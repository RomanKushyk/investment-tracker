import {
  useCallback,
  useLayoutEffect,
  useReducer,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type Ref,
} from 'react';

import { groupedForInput, valueFromInput } from '../../core/money';
import { caretAfterDigits, digitsBefore, withoutDigit } from './number-field';
import { useSettings } from '../../state/settings';

// BEHAVIOUR, NOT GEOMETRY: each of the six sites draws its own field, so
// `className` is the caller's and this sets no visual property — nor a font size,
// which `index.css` gives every input below 48rem.
// `value` is LANGUAGE-FREE and the display is derived from it (D87), so the
// language can change under a filled field without changing what it means.
export function NumberField({
  value,
  onChange,
  className = '',
  ref,
  ...rest
}: {
  /** Stored, not shown: `1234.5`, never `1 234,5`. */
  value: string;
  onChange: (next: string) => void;
  className?: string;
  ref?: Ref<HTMLInputElement>;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'className' | 'inputMode' | 'type' | 'ref'
>) {
  const language = useSettings((s) => s.language);
  const input = useRef<HTMLInputElement>(null);
  // Set only by `handleChange`, so an external write never moves the caret.
  const caret = useRef<number | null>(null);
  // A keystroke can leave the stored value untouched — a typed comma absorbed
  // under English — and an equal `setState` renders nothing, so the effect below
  // would never run to put the caret back. React restores the text itself.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const shown = groupedForInput(value, language);

  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const hold = useCallback(
    (el: HTMLInputElement | null) => {
      input.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const typed = event.target.value;
    const at = event.target.selectionStart ?? typed.length;
    const how = (event.nativeEvent as InputEvent).inputType ?? '';
    // A KEY IS THE ONLY THING THAT CAN MEAN A GROUPING MARK. Autofill, an IME
    // commit and a clipboard chip all arrive under their own `inputType`, so
    // anything that is not plain typing or deleting is read by the grammar.
    const arrived = !how.startsWith('insertText') && !how.startsWith('delete');
    const read = valueFromInput(typed, value, language, arrived);
    // A DELETE THAT ONLY REACHED A GROUPING MARK TAKES THE DIGIT IT GUARDS: the
    // mark is the field's own, so putting it back and stopping there makes the
    // key look broken — forward Delete could never get past one.
    const back = read === value && how.startsWith('delete') && !how.endsWith('Forward');
    const next =
      read === value && how.startsWith('delete')
        ? withoutDigit(value, digitsBefore(typed, at), !back)
        : read;
    // One digit fewer sits behind the caret once a Backspace has taken one.
    const digits = digitsBefore(typed, at) - (back ? 1 : 0);
    caret.current =
      at >= typed.length && !back
        ? groupedForInput(next, language).length
        : caretAfterDigits(groupedForInput(next, language), digits, back ? 0 : at);
    if (next === value) rerender();
    // NOT ON A NO-OP: in `QuoteRow` this lands on `setQuote`, which drops the
    // row's fetch provenance (G5) — a comma absorbed under English would have
    // taken the chip with it and made the row read as the user's own.
    if (next !== value) onChange(next);
  }

  return (
    <input
      {...rest}
      ref={hold}
      value={shown}
      onChange={handleChange}
      inputMode="decimal"
      className={className}
    />
  );
}

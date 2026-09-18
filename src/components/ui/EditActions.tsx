import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from './Dialog';
import { Button } from './Button';
import type { EditMode } from '../../hooks/useEditMode';
import { useT } from '../../i18n/useT';

/**
 * The screen-level edit control and the discard dialog that guards it.
 *
 * TWO VARIANTS, AND THE PAGE DECLARES WHICH: **batch** (`Cancel` + `Save`) for a
 * set that only means something whole, which on `/allocation` is Σ = 100, and
 * **entity** (`Done` alone) for a page whose actions already commit through
 * their own dialogs, which on `/portfolio` is asset create / edit / delete.
 *
 * AN ENTITY PAGE MUST NOT SHOW A SAVE, and that is why this is a variant rather
 * than a `hideSave` flag: every change is already written by the time the user
 * reaches it, so a Save would have nothing to write and a Cancel could not undo
 * the deletion behind it.
 *
 * A DISCRIMINATED UNION, not a flag bag. With `onSave` merely optional,
 * `<EditActions mode variant="batch" />` typechecked and rendered an enabled
 * Save wired to `undefined` — a button that silently does nothing while the page
 * stays dirty and the blocker fires on every navigation.
 *
 * The page-level signal is exactly one filled button while editing and none at
 * rest — no wash, no border, no banner — and the fill is the accent's, which
 * *Interaction rules* rations.
 */
type EditActionsProps = { mode: EditMode; busy?: boolean } & (
  | { variant: 'batch'; onSave: () => void; saveDisabled?: boolean }
  | { variant: 'entity'; onSave?: never; saveDisabled?: never }
);

export function EditActions(props: EditActionsProps) {
  const { mode, variant, busy = false } = props;
  const onSave = props.variant === 'batch' ? props.onSave : undefined;
  const saveDisabled = props.variant === 'batch' ? (props.saveDisabled ?? false) : false;
  const t = useT();

  return (
    <>
      {!mode.editing && (
        <Button variant="ghost" size="md" weight="semibold" onClick={mode.start}>
          {t.edit.edit}
        </Button>
      )}

      {mode.editing && variant === 'batch' && (
        <>
          <Button
            variant="ghost"
            size="md"
            weight="semibold"
            disabled={busy}
            onClick={mode.requestExit}
          >
            {t.edit.cancel}
          </Button>
          <Button
            variant="primary"
            size="md"
            weight="semibold"
            disabled={saveDisabled}
            onClick={onSave}
          >
            {t.edit.save}
          </Button>
        </>
      )}

      {mode.editing && variant === 'entity' && (
        <Button variant="primary" size="md" weight="semibold" onClick={mode.exit}>
          {t.edit.done}
        </Button>
      )}

      {/* `Dialog`, never the typed-name `AlertDialog`: nothing is destroyed
          here, only abandoned, and reserving the typed confirm for destruction
          is what keeps it meaning something. */}
      <Dialog open={mode.asking} onOpenChange={(open) => !open && mode.keepEditing()}>
        <DialogHeader>
          <DialogTitle className="text-[19px]">{t.edit.discardTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody className="text-[13px] leading-[1.55] text-muted">
          {t.edit.discardBody}
        </DialogBody>
        <DialogFooter>
          {/* The band pads itself and the row lives inside it: `DialogFooter`
              takes children only, so its gutter cannot be overridden per
              caller. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="md" weight="semibold" onClick={mode.keepEditing}>
              {t.edit.keepEditing}
            </Button>
            <Button variant="outlineDanger" size="md" weight="semibold" onClick={mode.discard}>
              {t.edit.discard}
            </Button>
          </div>
        </DialogFooter>
      </Dialog>
    </>
  );
}

import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './Dialog';
import { Button } from './Button';
import type { EditMode } from '../../hooks/useEditMode';
import { useT } from '../../i18n/useT';

/**
 * The screen-level edit control, in its two variants, plus the discard dialog
 * that guards it (brief § G-2, § G-4; extension § S1).
 *
 * TWO VARIANTS, AND THE PAGE DECLARES WHICH:
 *
 * - **batch** — `Cancel` + `Save`. For a set that only means something whole,
 *   which on `/allocation` is Σ = 100.
 * - **entity** — `Done` alone. For a page whose actions already commit through
 *   their own dialogs, which on `/portfolio` is asset create / edit / delete.
 *
 * **An entity page must NOT show a Save**, and that is the whole reason the
 * variant exists rather than a `hideSave` flag: by the time the user reaches
 * it every change is already written, so a Save would have nothing to write and
 * a Cancel could not undo the deletion behind it. A Save that saves nothing is
 * a lie; a Cancel that cannot undo is a worse one.
 *
 * WHAT THE TWO SHARE IS THE PAGE-LEVEL SIGNAL: exactly one filled button while
 * editing, and none at rest. That is the entire "this page is in edit mode"
 * treatment — no wash, no border, no banner (brief § G-5). The extension chose
 * a fill over a tint because a fill survives inversion: it is the darkest
 * object on the page in light and the brightest in dark, where a tint would
 * need re-deriving and would collide with `pos` / `neg` / `warn`.
 */
export function EditActions({
  mode,
  variant,
  onSave,
  saveDisabled = false,
}: {
  mode: EditMode;
  variant: 'batch' | 'entity';
  /** Batch only — the one explicit write. */
  onSave?: () => void;
  saveDisabled?: boolean;
}) {
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
          <Button variant="ghost" size="md" weight="semibold" onClick={mode.requestExit}>
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

      {/* `Dialog`, never the D17 typed-name `AlertDialog`: nothing is being
          destroyed here, only abandoned, and reserving the typed confirm for
          destruction is what keeps it meaning something. */}
      <Dialog open={mode.asking} onOpenChange={(open) => !open && mode.keepEditing()}>
        <DialogHeader>
          <DialogTitle className="text-[19px]">{t.edit.discardTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody className="text-[13px] leading-[1.55] text-muted">
          {t.edit.discardBody}
        </DialogBody>
        <DialogFooter>
          {/* The band pads itself; the row lives inside it — `DialogFooter`
              takes children only, which is what keeps its 28px gutter from
              being overridden per caller. */}
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

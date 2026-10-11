import { useLoadingAnnounced } from '../../hooks/loading';
import { useT } from '../../i18n/useT';

/** The one line a screen reader hears while placeholders wait. It sits OUTSIDE the busy screen,
 *  since an element under `aria-busy` may have its changes held until the busy period ends
 *  (WAI-ARIA 1.2), and it is mounted empty so that its text, when it comes, is a change. */
export function LoadingStatus() {
  const t = useT();
  return (
    <div role="status" className="sr-only">
      {useLoadingAnnounced() ? t.loading.status : ''}
    </div>
  );
}

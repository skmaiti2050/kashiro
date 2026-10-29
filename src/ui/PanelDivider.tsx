import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from './i18n/useT';
import { clampPanelWidth, PANEL_MAX, PANEL_MIN, panelWidthAfterKey } from './state/panelLayout';

interface Props {
  /** The review panel's width in CSS px. */
  width: number;
  /** A width the user chose (a key, or the end of a drag): shown and remembered. */
  onResize(width: number): void;
  /** A width while the mouse drags: shown only. */
  onDrag(width: number): void;
}

/** A drag in progress: what was read at its start, the latest width, and the frame that will show it. */
interface Drag {
  workspace: DOMRect;
  dir: 'ltr' | 'rtl';
  width: number | null;
  frame: number | null;
}

const directionOf = (el: Element) => (el.closest('[dir]')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr');

/**
 * The divider between the document and the review panel (F23 item 3): a WAI-ARIA window splitter. Its value is the
 * panel's width; the mouse drags it, the arrow keys move it 16 px, Home and End jump to the narrowest and widest.
 * A drag shows at most one width per frame and is remembered once, when it ends.
 */
export function PanelDivider({ width, onResize, onDrag }: Props) {
  const t = useT();
  const drag = useRef<Drag | null>(null);
  useEffect(
    () => () => {
      if (drag.current?.frame != null) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = panelWidthAfterKey(e.key, width, directionOf(e.currentTarget));
    if (next === null) return;
    e.preventDefault();
    onResize(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const workspace = e.currentTarget.parentElement!.getBoundingClientRect();
    drag.current = { workspace, dir: directionOf(e.currentTarget), width: null, frame: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // The panel runs from the pointer to the workspace's inline end.
    d.width = clampPanelWidth(d.dir === 'ltr' ? d.workspace.right - e.clientX : e.clientX - d.workspace.left);
    if (d.frame !== null) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = null;
      if (d.width !== null) onDrag(d.width);
    });
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    if (d.width !== null) onResize(d.width);
  };

  return (
    <div
      className="panel-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={t.t('split.resize')}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

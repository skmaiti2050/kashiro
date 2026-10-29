import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  PANEL_DEFAULT,
  panelWasCollapsed,
  rememberedPanelWidth,
  rememberPanelCollapsed,
  rememberPanelWidth,
} from './state/panelLayout';

/**
 * The review panel's width and folded state (F23 item 3), remembered across restarts. `style` sets the workspace's
 * --panel-width once the user has moved the divider (never past 70 % of the workspace); before that the CSS default
 * applies, and `width` is the panel's measured width. Folding moves focus to the button that unfolds it, and back.
 */
export function usePanelSplit() {
  const [chosen, setChosen] = useState(rememberedPanelWidth);
  const [measured, setMeasured] = useState(PANEL_DEFAULT);
  const [collapsed, setCollapsedState] = useState(panelWasCollapsed);
  const toggled = useRef(false);

  useLayoutEffect(() => {
    if (chosen !== null || collapsed) return;
    const panel = document.querySelector('.workspace > .review')?.getBoundingClientRect().width ?? 0;
    // No layout (jsdom) measures 0: keep the default.
    if (panel > 0) setMeasured(Math.round(panel));
  }, [chosen, collapsed]);

  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    document.querySelector<HTMLElement>(collapsed ? '.review-strip button' : '.panel-collapse')?.focus();
  }, [collapsed]);

  const resize = (width: number) => {
    setChosen(width);
    rememberPanelWidth(width);
  };
  const setCollapsed = (value: boolean) => {
    toggled.current = true;
    setCollapsedState(value);
    rememberPanelCollapsed(value);
  };
  const style = chosen === null ? undefined : ({ '--panel-width': `min(${chosen}px, 70%)` } as CSSProperties);
  return { width: chosen ?? measured, collapsed, setCollapsed, resize, style };
}

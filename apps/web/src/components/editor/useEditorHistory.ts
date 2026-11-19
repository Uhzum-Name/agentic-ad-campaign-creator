"use client";

import type { LayerOverrides } from "@adengine/design";
import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo over the variation's working overrides. Consecutive edits with the
 * same coalesce key (e.g. dragging a slider, nudging with arrow keys) within a
 * short window become one undo step.
 */
export function useEditorHistory(initial: LayerOverrides) {
  const [state, setState] = useState({ stack: [initial], index: 0 });
  const last = useRef<{ key?: string; at: number }>({ at: 0 });

  const push = useCallback((next: LayerOverrides, coalesceKey?: string) => {
    const now = Date.now();
    const coalesce = coalesceKey !== undefined && last.current.key === coalesceKey && now - last.current.at < 1200;
    last.current = { key: coalesceKey, at: now };
    setState(({ stack, index }) => {
      if (JSON.stringify(stack[index]) === JSON.stringify(next)) return { stack, index };
      const kept = stack.slice(0, coalesce && index > 0 ? index : index + 1);
      return { stack: [...kept, next], index: kept.length };
    });
  }, []);

  const reset = useCallback((to: LayerOverrides) => {
    last.current = { at: 0 };
    setState({ stack: [to], index: 0 });
  }, []);

  const undo = useCallback(() => {
    last.current = { at: 0 };
    setState((s) => ({ ...s, index: Math.max(0, s.index - 1) }));
  }, []);
  const redo = useCallback(() => {
    last.current = { at: 0 };
    setState((s) => ({ ...s, index: Math.min(s.stack.length - 1, s.index + 1) }));
  }, []);

  return {
    current: state.stack[state.index]!,
    canUndo: state.index > 0,
    canRedo: state.index < state.stack.length - 1,
    push,
    reset,
    undo,
    redo,
  };
}

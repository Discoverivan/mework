import type { FocusEvent, HTMLAttributes, PointerEvent } from "react";

// CSS :hover can also match a control when its associated label is hovered.
// Pointer events distinguish hovering the control itself without unlinking its label.
export function directPointerHover<T extends HTMLElement>({ onPointerEnter, onPointerLeave }: Pick<HTMLAttributes<T>, "onPointerEnter" | "onPointerLeave">) {
  return {
    onPointerEnter(event: PointerEvent<T>) {
      event.currentTarget.dataset.pointerHover = "true";
      onPointerEnter?.(event);
    },
    onPointerLeave(event: PointerEvent<T>) {
      delete event.currentTarget.dataset.pointerHover;
      onPointerLeave?.(event);
    },
  };
}

// A newly opened menu can appear under a stationary pointer. Wait for movement
// over an item before giving it the hover appearance.
export function directPointerMoveHover<T extends HTMLElement>({ onPointerMove, onPointerLeave, onBlur }: Pick<HTMLAttributes<T>, "onPointerMove" | "onPointerLeave" | "onBlur">) {
  return {
    onPointerMove(event: PointerEvent<T>) {
      if (event.pointerType !== "touch") event.currentTarget.dataset.pointerHover = "true";
      onPointerMove?.(event);
    },
    onPointerLeave(event: PointerEvent<T>) {
      delete event.currentTarget.dataset.pointerHover;
      onPointerLeave?.(event);
    },
    onBlur(event: FocusEvent<T>) {
      delete event.currentTarget.dataset.pointerHover;
      onBlur?.(event);
    },
  };
}

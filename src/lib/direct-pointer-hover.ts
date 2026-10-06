import type { HTMLAttributes, PointerEvent } from "react";

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

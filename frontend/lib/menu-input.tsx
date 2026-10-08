import { createContext, useContext, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const MenuInputContext = createContext({ keyboard: false, setKeyboard: (_value: boolean) => {} });

export function MenuInputProvider({ children }: { children: ReactNode }) {
  const [keyboard, setKeyboard] = useState(false);
  return <MenuInputContext.Provider value={{ keyboard, setKeyboard }}>{children}</MenuInputContext.Provider>;
}

// Radix focuses an item on opening even with the mouse. Only actual keyboard
// interaction should make that automatic focus look like keyboard navigation.
export function useMenuInput<T extends HTMLElement>(props: Pick<HTMLAttributes<T>, "onKeyDownCapture" | "onPointerDownCapture" | "onPointerMoveCapture">) {
  const { keyboard, setKeyboard } = useContext(MenuInputContext);
  return {
    "data-keyboard-navigation": keyboard,
    onKeyDownCapture(event: KeyboardEvent<T>) {
      if (!event.altKey && !event.ctrlKey && !event.metaKey
        && (event.key.length === 1 || ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter"].includes(event.key))) setKeyboard(true);
      props.onKeyDownCapture?.(event);
    },
    onPointerDownCapture(event: PointerEvent<T>) {
      setKeyboard(false);
      props.onPointerDownCapture?.(event);
    },
    onPointerMoveCapture(event: PointerEvent<T>) {
      setKeyboard(false);
      props.onPointerMoveCapture?.(event);
    },
  };
}

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const TooltipContext = React.createContext(false)

const Tooltip = ({ children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) => (
  <TooltipPrimitive.Root {...props}>
    <TooltipContext.Provider value={true}>{children}</TooltipContext.Provider>
  </TooltipPrimitive.Root>
)

function hasVisibleText(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim())
  if (node instanceof Element && (node.localName === "svg" || node.matches(".sr-only, .hidden, [hidden]"))) return false
  return Array.from(node.childNodes).some(hasVisibleText)
}

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onClick, onFocus, onPointerDown, onPointerMove, onKeyDown, ...props }, ref) => {
  const suppressRestoredFocus = React.useRef(false)
  return <TooltipPrimitive.Trigger
    {...props}
    ref={ref}
    onClick={(event) => {
      // Closing a picker returns focus here; that is not a request for its hint.
      suppressRestoredFocus.current = true
      onClick?.(event)
    }}
    onFocus={(event) => {
      onFocus?.(event)
      if (hasVisibleText(event.currentTarget) || suppressRestoredFocus.current || event.currentTarget.getAttribute("aria-expanded") === "true") {
        event.preventDefault()
      }
      suppressRestoredFocus.current = false
    }}
    onPointerDown={(event) => {
      onPointerDown?.(event)
      if (event.button === 0) suppressRestoredFocus.current = true
    }}
    onPointerMove={(event) => {
      onPointerMove?.(event)
      if (hasVisibleText(event.currentTarget) || event.currentTarget.getAttribute("aria-expanded") === "true") {
        event.preventDefault()
      } else if (!event.defaultPrevented && event.pointerType !== "touch") {
        suppressRestoredFocus.current = false
      }
    }}
    onKeyDown={(event) => {
      onKeyDown?.(event)
      if (!event.defaultPrevented && event.key === "Tab") suppressRestoredFocus.current = false
      // Selects and menus can open without a click, including when their handler prevents default.
      if (event.currentTarget.hasAttribute("aria-expanded") && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        suppressRestoredFocus.current = true
      }
    }}
  />
})
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, side = "bottom", sideOffset = 8, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      side={side}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        "z-50 max-w-[min(20rem,calc(100vw-1rem))] break-words rounded-md border border-border bg-popover px-3 py-2 text-xs leading-snug text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

// Tooltip state must not replace state owned by selects, toggles or menus.
const HintTarget = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & { children: React.ReactElement; "data-state"?: string }>(
  ({ children, "data-state": _tooltipState, ...props }, ref) => <Slot {...props} ref={ref}>{children}</Slot>,
)
HintTarget.displayName = "HintTarget"

type HintProps = Omit<React.HTMLAttributes<HTMLElement>, "content" | "children"> & { content?: React.ReactNode; children: React.ReactElement }

/** Styled replacement for native title, preserving trigger events and refs. */
const Hint = React.forwardRef<HTMLElement, HintProps>(({ content, children, ...props }, ref) => {
  const hasTooltip = React.useContext(TooltipContext)
  const target = <Slot {...props} ref={ref} data-tooltip={typeof content === "string" ? content : undefined}>{children}</Slot>
  if (hasTooltip || !content) return target
  return <TooltipProvider delayDuration={300}><Tooltip>
    <TooltipTrigger asChild><HintTarget>{target}</HintTarget></TooltipTrigger>
    <TooltipContent>{content}</TooltipContent>
  </Tooltip></TooltipProvider>
})
Hint.displayName = "Hint"

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Hint }

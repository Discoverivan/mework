"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { controlBorderClasses } from "@/lib/control-border"
import { directPointerHover, directPointerMoveHover } from "@/lib/direct-pointer-hover"
import { MenuInputProvider, useMenuInput } from "@/lib/menu-input"
import { Hint } from "@/components/ui/tooltip"
import "./select.css"

const SelectTriggerContext = React.createContext<React.RefObject<HTMLButtonElement | null> | null>(null)

const Select = ({ autoComplete = "off", ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) => {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  return <SelectTriggerContext.Provider value={triggerRef}><MenuInputProvider><SelectPrimitive.Root autoComplete={autoComplete} {...props} /></MenuInputProvider></SelectTriggerContext.Provider>
}

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, title, ...props }, ref) => {
  const triggerRef = React.useContext(SelectTriggerContext)
  return (
  <Hint content={title}>
    <SelectPrimitive.Trigger
      ref={(element) => {
        if (triggerRef) triggerRef.current = element
        if (typeof ref === "function") ref(element)
        else if (ref) ref.current = element
      }}
      className={cn(
        "flex h-9 w-fit max-w-full items-center justify-between gap-2 rounded-md border border-input bg-control px-3 py-1 text-[13.5px] ring-offset-background transition-colors data-[placeholder]:text-muted-foreground data-[pointer-hover=true]:data-[state=closed]:enabled:text-primary focus:outline-none focus:ring-0 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
        controlBorderClasses,
        className
      )}
      {...props}
      {...useMenuInput<HTMLButtonElement>(props)}
      {...directPointerHover<HTMLButtonElement>(props)}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="-mr-1 h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  </Hint>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", align, ...props }, ref) => {
  const triggerRef = React.useContext(SelectTriggerContext)
  const [menuAlign, setMenuAlign] = React.useState<"start" | "center" | "end">("start")
  return (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={(element) => {
        // Portals do not inherit the trigger's compact/page typography.
        const trigger = triggerRef?.current
        if (element && trigger) {
          const inheritedAlign = trigger.closest("[data-menu-align]")?.getAttribute("data-menu-align")
          setMenuAlign(inheritedAlign === "end" || inheritedAlign === "center" ? inheritedAlign : "start")
          const triggerStyle = getComputedStyle(trigger)
          element.style.setProperty("--select-trigger-font-size", triggerStyle.fontSize)
          const height = trigger.getBoundingClientRect().height || Number.parseFloat(triggerStyle.height)
          element.style.setProperty("--select-item-padding-y", height <= 32 ? "4px" : "6px")
        }
        if (typeof ref === "function") ref(element)
        else if (ref) ref.current = element
      }}
      className={cn(
        "relative z-50 w-max max-w-[calc(100vw-2rem)] max-h-[var(--radix-select-content-available-height)] overflow-hidden rounded-md border bg-popover text-popover-foreground text-[length:var(--select-trigger-font-size,14px)] shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      align={align ?? menuAlign}
      {...props}
      {...useMenuInput<HTMLDivElement>(props)}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "select-scroll-viewport min-h-0 p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-max min-w-[var(--radix-select-trigger-width)] max-w-full"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-[var(--select-item-padding-y,6px)] pl-8 pr-2 text-[length:inherit] font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-sm px-3 py-[var(--select-item-padding-y,6px)] text-[length:inherit] outline-none data-[pointer-hover=true]:text-primary data-[keyboard-navigation=true]:data-[highlighted]:text-primary data-[state=checked]:bg-primary/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
    {...useMenuInput<HTMLDivElement>(props)}
    {...directPointerMoveHover<HTMLDivElement>(props)}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}

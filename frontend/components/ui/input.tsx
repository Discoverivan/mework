import * as React from "react"

import { cn } from "@/lib/utils"
import { controlBorderClasses } from "@/lib/control-border"
import { directPointerHover } from "@/lib/direct-pointer-hover"
import { Hint } from "@/components/ui/tooltip"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, title, ...props }, ref) => {
    return (
      <Hint content={title}>
        <input
          autoComplete="off"
          type={type}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            (type === "number" || props.inputMode === "numeric" || props.inputMode === "decimal") && "bg-control",
            controlBorderClasses,
            className
          )}
          ref={ref}
          {...props}
          {...directPointerHover<HTMLInputElement>(props)}
        />
      </Hint>
    )
  }
)
Input.displayName = "Input"

export { Input }

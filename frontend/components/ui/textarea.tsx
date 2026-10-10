import * as React from "react"

import { cn } from "@/lib/utils"
import { controlBorderClasses } from "@/lib/control-border"
import { directPointerHover } from "@/lib/direct-pointer-hover"
import { Hint } from "@/components/ui/tooltip"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, title, ...props }, ref) => {
  return (
    <Hint content={title}>
      <textarea
        autoComplete="off"
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          controlBorderClasses,
          className
        )}
        ref={ref}
        {...props}
        {...directPointerHover<HTMLTextAreaElement>(props)}
      />
    </Hint>
  )
})
Textarea.displayName = "Textarea"

export { Textarea }

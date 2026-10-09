import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { controlBorderClasses } from "@/lib/control-border"
import { directPointerHover } from "@/lib/direct-pointer-hover"
import { Hint } from "@/components/ui/tooltip"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-primary focus-visible:text-primary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-primary focus-visible:text-primary",
        ghost: "hover:bg-accent hover:text-primary focus-visible:text-primary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  actionTone?: "add" | "edit" | "delete" | "neutral" | "success" | "warning"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ actionTone, className, variant, size, asChild = false, title, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const isAction = props.role !== "combobox" && props["aria-pressed"] === undefined && !("data-day" in props)
    const isPicker = props.role === "combobox" && variant === "outline"
    const variantClasses = buttonVariants({ variant, size })
    return (
      <Hint content={title}>
        <Comp
          className={cn(
            isPicker ? variantClasses.split(" ").filter((value) => !value.startsWith("hover:")).join(" ") : variantClasses,
            isPicker && "data-[pointer-hover=true]:text-primary",
            isPicker && controlBorderClasses,
            isPicker && "bg-control",
            size === "icon" && "app-icon-button",
            size !== "icon" && isAction && (variant !== "link" || actionTone) && "app-action-text",
            (actionTone === "success" || actionTone === "add") && "hover:text-success focus-visible:text-success",
            actionTone === "warning" && "hover:text-warning focus-visible:text-warning",
            actionTone === "delete" && "hover:text-destructive focus-visible:text-destructive",
            className,
          )}
          data-action-tone={actionTone}
          data-button-variant={variant ?? "default"}
          ref={ref}
          {...props}
          {...(isPicker ? directPointerHover<HTMLButtonElement>(props) : {})}
        />
      </Hint>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

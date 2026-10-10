import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Hint } from "@/components/ui/tooltip"

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  {
    variants: {
      alignment: {
        field: "app-field-label pl-1",
        inline: "pl-0",
      },
    },
    defaultVariants: { alignment: "field" },
  },
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ alignment, className, title, ...props }, ref) => (
  <Hint content={title}>
    <LabelPrimitive.Root
      ref={ref}
      className={cn(labelVariants({ alignment }), className)}
      {...props}
    />
  </Hint>
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }

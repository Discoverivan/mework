import { forwardRef } from "react";
import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";

type CreateButtonProps = Omit<ButtonProps, "children" | "size" | "asChild" | "actionTone"> & { iconOnly?: boolean; label?: string };

export const CreateButton = forwardRef<HTMLButtonElement, CreateButtonProps>(
  ({ className, variant = "outline", type = "button", iconOnly = false, label, ...props }, ref) => {
    const { t } = useI18n();
    return <Button {...props} ref={ref} type={type} variant={variant} size={iconOnly ? "icon" : "sm"} actionTone="add" className={cn("shrink-0", !iconOnly && "app-create-button", className)}>
      <Plus aria-hidden="true" />
      {!iconOnly ? label ?? t("common.create") : null}
    </Button>;
  },
);
CreateButton.displayName = "CreateButton";

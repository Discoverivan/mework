import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/context";

export function StoredSecretInput({ hasStoredValue, className, ...props }: ComponentProps<typeof Input> & { hasStoredValue: boolean }) {
  const { t } = useI18n();
  return <Input {...props} type="password" autoComplete="new-password"
    placeholder={hasStoredValue ? "••••••••" : props.placeholder}
    title={hasStoredValue ? t("forms.storedSecretHelp") : props.title}
    className={cn(hasStoredValue && "placeholder:text-xs placeholder:font-normal placeholder:tracking-widest placeholder:text-muted-foreground/60 data-[pointer-hover=true]:placeholder:text-transparent focus:placeholder:text-transparent", className)} />;
}

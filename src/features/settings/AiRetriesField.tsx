import { useState } from "react";
import { CircleAlert } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useI18n } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";
import { cn } from "@/lib/utils";

interface AiRetriesFieldProps {
  id: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function validateRetries(value: string): TranslationKey | null {
  if (!value.trim()) return "settings.ai.retriesRequired";
  if (!/^-?\d+$/.test(value.trim())) return "settings.ai.retriesInteger";
  const retries = Number(value);
  return retries < 0 || retries > 10 ? "settings.ai.retriesRange" : null;
}

export function AiRetriesField({ id, value, disabled, onChange }: AiRetriesFieldProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [showError, setShowError] = useState(false);

  function validate(raw: string, allowEmpty: boolean) {
    const nextError = allowEmpty && !raw.trim() ? null : validateRetries(raw);
    setError(nextError);
    setShowError(Boolean(nextError));
    return nextError;
  }

  return <div role="group" className="grid w-fit gap-2.5" data-disabled={disabled}>
    <span id={`${id}-label`} className="whitespace-nowrap px-1 text-sm font-medium leading-none" title={t("settings.ai.retriesDescription")}>{t("settings.ai.retries")}</span>
    <Popover open={showError && Boolean(error)} onOpenChange={setShowError}>
      <PopoverAnchor asChild><Input
        id={id}
        className={cn("h-9 w-12 min-w-full", error && "border-destructive ring-1 ring-destructive focus-visible:ring-destructive")}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft ?? String(value)}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-description={t(error ?? "settings.ai.retriesDescription")}
        aria-invalid={Boolean(error)}
        onFocus={() => setShowError(Boolean(error))}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setDraft(raw);
          if (!validate(raw, true) && raw.trim()) onChange(Number(raw));
        }}
        onBlur={(event) => {
          if (!validate(event.currentTarget.value, false)) setDraft(null);
        }}
      /></PopoverAnchor>
      <PopoverContent
        id={`${id}-error`}
        role="alert"
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="flex gap-2 border-destructive/50 px-3 py-2 text-sm text-destructive"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target instanceof HTMLElement && event.target.id === id) event.preventDefault();
        }}
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{error ? t(error) : null}</span>
      </PopoverContent>
    </Popover>
  </div>;
}

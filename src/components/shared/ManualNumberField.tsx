import { Hint } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { scaleWholeNumber } from "@/lib/scaled-number";

interface ManualNumberFieldProps {
  id: string;
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  scale?: number;
  allowDecimals?: boolean;
  disabled?: boolean;
  errors: { required: string; number: string; range: string; whole?: string };
  onChange: (value: number) => void;
  onValidityChange?: (valid: boolean) => void;
}

export function ManualNumberField({ id, label, description, value, min, max, scale = 1, allowDecimals = false, disabled = false, errors, onChange, onValidityChange }: ManualNumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  function validation(raw: string) {
    if (!raw.trim()) return errors.required;
    const pattern = allowDecimals ? /^-?\d+(?:[.,]\d+)?$/ : /^-?\d+$/;
    if (!pattern.test(raw.trim())) return errors.number;
    const number = Number(raw.trim().replace(",", ".")) * scale;
    if (!Number.isFinite(number) || number < min || number > max) return errors.range;
    return Number.isSafeInteger(scaleWholeNumber(raw, scale)) ? null : errors.whole ?? errors.number;
  }

  useEffect(() => {
    const nextError = validation(String(value));
    setDraft(null);
    setError(nextError);
    setShowError(Boolean(nextError));
    onValidityChange?.(!nextError);
    // Revalidate when the saved value, units, bounds, or localized messages change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max, scale, allowDecimals, errors.required, errors.number, errors.range, errors.whole, onValidityChange]);

  function validate(raw: string, allowEmpty: boolean) {
    const nextError = validation(raw);
    setError(allowEmpty && !raw.trim() ? null : nextError);
    setShowError(Boolean(nextError) && (!allowEmpty || Boolean(raw.trim())));
    onValidityChange?.(!nextError);
    return nextError;
  }

  return <div role="group" className="grid w-fit gap-2.5" data-disabled={disabled}>
    <Hint content={description}><span id={`${id}-label`} className="whitespace-nowrap px-1 text-sm font-medium leading-none">{label}</span></Hint>
    <Popover open={!disabled && showError && Boolean(error)} onOpenChange={setShowError}>
      <PopoverAnchor asChild><Input
        id={id}
        className={cn("h-9 w-12 min-w-full", error && "border-destructive ring-1 ring-destructive focus-visible:ring-destructive")}
        type="text"
        inputMode={allowDecimals ? "decimal" : "numeric"}
        autoComplete="off"
        value={draft ?? String(value)}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-description={error ?? description}
        aria-invalid={Boolean(error)}
        onFocus={() => setShowError(Boolean(error))}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setDraft(raw);
          if (!validate(raw, true)) onChange(Number(raw.trim().replace(",", ".")));
        }}
        onBlur={(event) => {
          if (!validate(event.currentTarget.value, false)) setDraft(null);
        }}
      /></PopoverAnchor>
      <PopoverContent role="alert" side="bottom" align="start" sideOffset={6} collisionPadding={8}
        className="flex gap-2 border-destructive/50 px-3 py-2 text-sm text-destructive"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => { if (event.target instanceof HTMLElement && event.target.id === id) event.preventDefault(); }}
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </PopoverContent>
    </Popover>
  </div>;
}

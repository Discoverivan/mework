import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { useI18n } from "@/i18n/context";
import { InfoPopover } from "@/components/shared/InfoPopover";
import { Label } from "@/components/ui/label";

interface AiRetriesFieldProps {
  id: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  rows?: boolean;
}

export function AiRetriesField({ rows, ...props }: AiRetriesFieldProps) {
  const { t } = useI18n();
  const field = <ManualNumberField {...props} min={0} max={10} labelledBy={rows ? `${props.id}-label` : undefined}
    label={t("settings.ai.retries")}
    description={t("settings.ai.retriesDescription")}
    errors={{ required: t("settings.ai.retriesRequired"), number: t("settings.ai.retriesInteger"), range: t("settings.ai.retriesRange") }}
  />;
  return rows ? <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-1">
      <Label id={`${props.id}-label`} htmlFor={props.id} alignment="inline">{t("settings.ai.retries")}</Label>
      <InfoPopover label={t("settings.ai.advanced.retriesHelp")} title={t("settings.ai.retries")}><p>{t("settings.ai.retriesDescription")}</p></InfoPopover>
    </div>
    {field}
  </div> : field;
}

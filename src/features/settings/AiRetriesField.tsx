import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { useI18n } from "@/i18n/context";

interface AiRetriesFieldProps {
  id: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

export function AiRetriesField(props: AiRetriesFieldProps) {
  const { t } = useI18n();
  return <ManualNumberField {...props} min={0} max={10}
    label={t("settings.ai.retries")}
    description={t("settings.ai.retriesDescription")}
    errors={{ required: t("settings.ai.retriesRequired"), number: t("settings.ai.retriesInteger"), range: t("settings.ai.retriesRange") }}
  />;
}

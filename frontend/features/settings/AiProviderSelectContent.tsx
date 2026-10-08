import { SelectContent, SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { useI18n } from "@/i18n/context";
import type { AiProvider } from "@/shared/contracts/settings";

const GROUP_LABEL_CLASS = "flex cursor-default items-center gap-2 px-2 pt-1 pb-0.5 text-[10px] font-normal leading-4 text-muted-foreground before:h-px before:flex-1 before:bg-border/80 before:content-[''] after:h-px after:flex-1 after:bg-border/80 after:content-['']";

export function AiProviderSelectContent({ providers, fallbackValue, fallbackLabel, unavailableLabel }: {
  providers: AiProvider[];
  fallbackValue: string;
  fallbackLabel: string;
  unavailableLabel?: string;
}) {
  const { t } = useI18n();
  const groups = [
    { kind: "cli", label: t("settings.aiProviders.cliGroup"), providers: providers.filter((provider) => provider.id !== "openai-compatible") },
    { kind: "api", label: t("settings.aiProviders.apiGroup"), providers: providers.filter((provider) => provider.id === "openai-compatible") },
  ];
  return <SelectContent>
    <SelectItem value={fallbackValue}>{fallbackLabel}</SelectItem>
    {groups.filter((group) => group.providers.length > 0).map((group) => <SelectGroup key={group.kind}>
      <SelectLabel className={GROUP_LABEL_CLASS} data-testid={`ai-provider-${group.kind}-group-label`}>{group.label}</SelectLabel>
      {group.providers.map((provider) => <SelectItem key={provider.instanceId ?? provider.id} value={provider.instanceId ?? provider.id} disabled={!provider.available}>
        {provider.name}{provider.name === "OpenAI-compatible API" && provider.baseUrl ? ` · ${provider.baseUrl}` : ""}{provider.available ? "" : ` (${unavailableLabel ?? t("settings.ai.unavailableSuffix")})`}
      </SelectItem>)}
    </SelectGroup>)}
  </SelectContent>;
}

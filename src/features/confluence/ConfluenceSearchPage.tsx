import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ExternalLink, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { useI18n } from "@/i18n/context";
import type { ConfluenceSearchResult } from "@/shared/contracts/confluence";
import { listIntegrations } from "@/features/settings/api";
import { listManagedProjects } from "@/features/settings/planning-projects/api";
import type { ManagedProjectSettings } from "@/shared/contracts/settings";

import { searchConfluence } from "./api";

export function ConfluenceSearchPage() {
  const { locale, t } = useI18n();
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [teamSpaces, setTeamSpaces] = useState<ManagedProjectSettings[]>([]);
  const [spaceKey, setSpaceKey] = useState("");
  const [results, setResults] = useState<ConfluenceSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listIntegrations(), listManagedProjects()]).then(([integrations, projects]) => {
      if (!active) return;
      const confluence = integrations.find((integration) =>
        integration.kind === "confluence"
        && integration.enabled
        && integration.healthStatus === "working"
      );
      setIntegrationId(confluence?.id ?? null);
      const matchingProjects = projects.filter((project) =>
        project.confluenceSpace?.integrationId === confluence?.id
      );
      setTeamSpaces(matchingProjects);
      setSpaceKey(matchingProjects[0]?.confluenceSpace?.spaceKey ?? "");
    });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!integrationId || !trimmed || searching) return;
    setSearching(true);
    setError(null);
    try {
      const response = await searchConfluence(integrationId, trimmed, 20, spaceKey || undefined);
      setResults(response.results);
      setSearched(true);
    } catch (searchError) {
      const message = searchError && typeof searchError === "object" && "message" in searchError
        && typeof searchError.message === "string"
        ? searchError.message
        : searchError instanceof Error ? searchError.message : String(searchError);
      setError(message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <section aria-labelledby="confluence-search-title" className="space-y-5">
      <PageHeader
        title={t("confluence.title")}
        titleId="confluence-search-title"
        description={t("confluence.description")}
      />

      <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
        {teamSpaces.length > 0 ? (
          <div className="grid min-w-64 gap-2">
            <Label htmlFor="confluence-search-space" className="pl-1">{t("confluence.scope")}</Label>
            <div className="relative">
              <select
                id="confluence-search-space"
                aria-label={t("confluence.scope")}
                className="h-10 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm"
                value={spaceKey}
                onChange={(event) => setSpaceKey(event.target.value)}
                disabled={searching}
              >
                {teamSpaces.map((project) => (
                  <option key={project.id} value={project.confluenceSpace?.spaceKey}>
                    {project.projectName} · {project.confluenceSpace?.spaceName}
                  </option>
                ))}
                <option value="">{t("confluence.allSpaces")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
            </div>
          </div>
        ) : null}
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="confluence-search-query" className="pl-1">{t("confluence.query")}</Label>
          <Input
            id="confluence-search-query"
            value={query}
            maxLength={200}
            placeholder={t("confluence.queryPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            disabled={searching}
          />
        </div>
        <Button type="submit" disabled={!integrationId || !query.trim() || searching}>
          <Search aria-hidden="true" />
          {searching ? t("confluence.searching") : t("confluence.search")}
        </Button>
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("confluence.errorTitle")}</AlertTitle>
          <AlertDescription>{t("confluence.errorDescription", { error })}</AlertDescription>
        </Alert>
      ) : null}

      {searched ? (
        <div className="space-y-3" aria-live="polite">
          <h2 className="text-lg font-semibold">{t("confluence.results")}</h2>
          {results.length === 0 ? (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">{t("confluence.noResults")}</CardContent></Card>
          ) : results.map((result) => (
            <Card key={`${result.id}:${result.url ?? "no-url"}`}>
              <CardHeader className="gap-2 pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-base leading-snug">{result.title}</CardTitle>
                    <CardDescription>
                      {result.spaceName ?? t("confluence.unknownSpace")}
                      {result.lastModified ? ` · ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(result.lastModified))}` : ""}
                    </CardDescription>
                  </div>
                  {result.url ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void openUrl(result.url!)}
                    >
                      <ExternalLink aria-hidden="true" />
                      {t("confluence.openPage")}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              {result.excerpt ? <CardContent className="text-sm text-muted-foreground">{result.excerpt}</CardContent> : null}
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  );
}

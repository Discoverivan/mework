import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, LoaderCircle, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { useI18n } from "@/i18n/context";
import type { ConfluenceSearchResult } from "@/shared/contracts/confluence";
import { listIntegrations } from "@/features/settings/api";
import { listManagedProjects } from "@/features/settings/planning-projects/api";
import type { ManagedProjectSettings } from "@/shared/contracts/settings";

import { searchConfluence } from "./api";

const ALL_SPACES_VALUE = "__all_spaces__";

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
        confluence !== undefined && project.confluenceSpace?.integrationId === confluence.id
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

      <form autoComplete="off" className="flex flex-wrap items-end gap-3" onSubmit={submit}>
        {teamSpaces.length > 0 ? (
          <div className="grid min-w-0 max-w-full gap-2">
            <Label htmlFor="confluence-search-space">{t("confluence.scope")}</Label>
            <Select value={spaceKey || ALL_SPACES_VALUE} onValueChange={(value) => setSpaceKey(value === ALL_SPACES_VALUE ? "" : value)} disabled={searching}>
              <SelectTrigger id="confluence-search-space" aria-label={t("confluence.scope")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {teamSpaces.map((project) => (
                  <SelectItem key={project.id} value={project.confluenceSpace!.spaceKey}>
                    {project.projectName} · {project.confluenceSpace?.spaceName}
                  </SelectItem>
                ))}
                <SelectItem value={ALL_SPACES_VALUE}>{t("confluence.allSpaces")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="confluence-search-query">{t("confluence.query")}</Label>
          <Input
            id="confluence-search-query"
            value={query}
            maxLength={200}
            placeholder={t("confluence.queryPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            disabled={searching}
          />
        </div>
        <div className="flex h-10 shrink-0 items-center">
          <Button
            type="submit"
            className="shrink-0"
            aria-label={searching ? t("confluence.searching") : t("confluence.search")}
            title={searching ? t("confluence.searching") : t("confluence.search")}
            disabled={!integrationId || !query.trim() || searching}
          >
            {searching ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search className="knowledge-search-icon" aria-hidden="true" />}
            {searching ? t("confluence.searching") : t("confluence.search")}
          </Button>
        </div>
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
            <Card><CardContent className="px-4 py-3 text-sm text-muted-foreground">{t("confluence.noResults")}</CardContent></Card>
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
                      size="icon"
                      className="shrink-0"
                      aria-label={t("confluence.openPage")}
                      title={t("confluence.openPage")}
                      onClick={() => void openUrl(result.url!)}
                    >
                      <ExternalLink aria-hidden="true" />
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

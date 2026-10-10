import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, Filter, RefreshCw, Settings2, Trash2, FilePenLine } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import { matchesSelectedAiProvider } from "@/shared/contracts/settings";
import type {
  BitbucketProject,
  BitbucketRepository,
  BitbucketUser,
  MyPullRequest,
  MyPullRequestPage,
  PullRequestPublishableComment,
  PullRequestReviewSettings,
  PullRequestReviewState,
} from "@/shared/contracts/developer";

import { PullRequestListItem } from "./components/PullRequestListItem";
import { PullRequestDisplayOptionsDialog } from "./components/PullRequestDisplayOptionsDialog";
import { PullRequestProjectSection } from "./components/PullRequestProjectSection";
import { PullRequestReviewDialog } from "./components/PullRequestReviewDialog";
import { PullRequestTargetPicker } from "./components/PullRequestTargetPicker";
import { ReviewInstructionsDialog, type ReviewInstructionTarget } from "./components/ReviewInstructionsDialog";
import { PullRequestStatus } from "./components/PullRequestStatus";
import { usePullRequestDisplayPreferences, usePullRequestQuickFilter } from "./display-options";
import {
  groupPullRequestsByPerson,
  groupPullRequestsByProject,
  sortPullRequestsByUpdatedDate,
} from "./components/pull-request-projects";
import { PageHeader } from "@/components/shared/PageHeader";
import { InfoPopover } from "@/components/shared/InfoPopover";
import { useI18n } from "@/i18n/context";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import { shouldRefreshPullRequestCache } from "./pull-request-cache";
import { usePullRequestReviewPolling } from "./review-polling";

import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  listMyPullRequests,
  markAllPullRequestsRead,
  markPullRequestRead,
  publishPullRequestComment,
  refreshMyPullRequests,
  removePullRequestReviewer,
  savePullRequestReviewSettings,
  setPullRequestDecision,
  searchBitbucketProjects,
  searchBitbucketRepositories,
  searchBitbucketUsers,
  startPullRequestReview,
} from "./api";


type FilterTab = "blacklist" | "whitelist";
type FilterKind = "project" | "repository" | "creator";
type FilterField =
  | "projectBlacklist"
  | "projectWhitelist"
  | "repositoryBlacklist"
  | "creatorBlacklist"
  | "repositoryWhitelist"
  | "creatorWhitelist";

function filterField(tab: FilterTab, kind: FilterKind): FilterField {
  if (kind === "project") return tab === "blacklist" ? "projectBlacklist" : "projectWhitelist";
  if (tab === "blacklist") return kind === "repository" ? "repositoryBlacklist" : "creatorBlacklist";
  return kind === "repository" ? "repositoryWhitelist" : "creatorWhitelist";
}


const emptySettings: PullRequestReviewSettings = {
  filterMode: "deny",
  projectBlacklist: [],
  projectWhitelist: [],
  repositoryBlacklist: [],
  creatorBlacklist: [],
  repositoryWhitelist: [],
  creatorWhitelist: [],
  autoReviewEnabled: false,
  authoredAutoReviewEnabled: false,
};

function repositoryKey(pullRequest: MyPullRequest): string {
  return `${pullRequest.projectKey}/${pullRequest.repositorySlug}`;
}

function repositoryOptionKey(repository: BitbucketRepository): string {
  return `${repository.projectKey}/${repository.repositorySlug}`;
}

function repositoryOptionLabel(repository: BitbucketRepository): string {
  return `${repositoryOptionKey(repository)} · ${repository.repositoryName}`;
}

function creatorOptionValue(user: BitbucketUser): string | undefined {
  return user.displayName ?? user.name ?? user.slug;
}

// Filters store global target values; scoped provider search can return the same value twice.
function uniqueFilterTargets<T>(values: T[], key: (value: T) => string | undefined): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value)?.trim().toLocaleLowerCase();
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function matchesSettings(pullRequest: MyPullRequest, settings: PullRequestReviewSettings): boolean {
  const repositoryWhitelistMatches = settings.repositoryWhitelist.some((value) =>
    [pullRequest.projectKey, repositoryKey(pullRequest), pullRequest.repositorySlug, pullRequest.repositoryName]
      .some((candidate) => equalsIgnoreCase(value, candidate)),
  );
  const creatorWhitelistMatches = settings.creatorWhitelist.some((value) =>
    equalsIgnoreCase(value, pullRequest.authorDisplayName),
  );
  const repositoryBlacklistMatches = settings.repositoryBlacklist.some((value) =>
    [pullRequest.projectKey, repositoryKey(pullRequest), pullRequest.repositorySlug, pullRequest.repositoryName]
      .some((candidate) => equalsIgnoreCase(value, candidate)),
  );
  const creatorBlacklistMatches = settings.creatorBlacklist.some((value) =>
    equalsIgnoreCase(value, pullRequest.authorDisplayName),
  );
  const projectWhitelistMatches = settings.projectWhitelist.some((value) => equalsIgnoreCase(value, pullRequest.projectKey));
  const projectBlacklistMatches = settings.projectBlacklist.some((value) => equalsIgnoreCase(value, pullRequest.projectKey));
  const whitelistMatches = projectWhitelistMatches || repositoryWhitelistMatches || creatorWhitelistMatches;
  const blacklistMatches = projectBlacklistMatches || repositoryBlacklistMatches || creatorBlacklistMatches;
  return settings.filterMode === "allow" ? whitelistMatches : !blacklistMatches;
}

function commandError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const structured = error as { message?: unknown; code?: unknown };
    if (typeof structured.message === "string" && structured.message.trim()) return structured.message;
    if (typeof structured.code === "string" && structured.code.trim()) return `Command failed (${structured.code})`;
  }
  return "Unknown command error";
}

function pullRequestKey(
  pullRequest: Pick<MyPullRequest, "integrationId" | "projectKey" | "repositorySlug" | "pullRequestId">
): string {
  return `${pullRequest.integrationId}:${pullRequest.projectKey}:${pullRequest.repositorySlug}:${pullRequest.pullRequestId}`;
}

function activityRank(activity: MyPullRequest["activity"]): number {
  if (activity === "new") return 0;
  if (activity === "updated") return 1;
  return 2;
}

function sortPullRequests(values: MyPullRequest[]): MyPullRequest[] {
  return [...values].sort((left, right) => {
    const activityOrder = activityRank(left.activity) - activityRank(right.activity);
    if (activityOrder !== 0) return activityOrder;
    const leftUpdated = left.updatedDate ?? Number.NEGATIVE_INFINITY;
    const rightUpdated = right.updatedDate ?? Number.NEGATIVE_INFINITY;
    return rightUpdated - leftUpdated || left.pullRequestId.localeCompare(right.pullRequestId);
  });
}

export function MyPullRequestsPage() {
  const { t } = useI18n();
  const [pullRequests, setPullRequests] = useState<MyPullRequest[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettingsPageData | null>(null);
  const [settings, setSettings] = useState<PullRequestReviewSettings>(emptySettings);
  const [draftSettings, setDraftSettings] = useState<PullRequestReviewSettings>(emptySettings);
  const [projectInput, setProjectInput] = useState("");
  const [projectSearchResults, setProjectSearchResults] = useState<BitbucketProject[]>([]);
  const [projectSearchLoading, setProjectSearchLoading] = useState(false);
  const [projectSearchError, setProjectSearchError] = useState<string>();
  const [repositoryInput, setRepositoryInput] = useState("");
  const [repositorySearchResults, setRepositorySearchResults] = useState<BitbucketRepository[]>([]);
  const [repositorySearchLoading, setRepositorySearchLoading] = useState(false);
  const [repositorySearchError, setRepositorySearchError] = useState<string>();
  const [creatorInput, setCreatorInput] = useState("");
  const [creatorSearchResults, setCreatorSearchResults] = useState<BitbucketUser[]>([]);
  const [creatorSearchLoading, setCreatorSearchLoading] = useState(false);
  const [creatorSearchError, setCreatorSearchError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionTarget, setInstructionTarget] = useState<ReviewInstructionTarget>();
  const [filterSearch, setFilterSearch] = useState<FilterKind>();
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false);
  const [displayPreferences, updateDisplayPreferences] = usePullRequestDisplayPreferences("reviewer");
  const [filterTab, setFilterTab] = useState<FilterTab>("blacklist");
  const [quickFilter, setQuickFilter] = usePullRequestQuickFilter("reviewer");
  const [saving, setSaving] = useState(false);
  const [blacklisting, setBlacklisting] = useState(false);
  const settingsWritePending = useRef(false);
  const [autoReviewSaving, setAutoReviewSaving] = useState(false);
  const settingsSaving = saving || autoReviewSaving || blacklisting;
  const [settingsError, setSettingsError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [polling, setPolling] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [readAllPending, setReadAllPending] = useState(false);
  const [reviewStartingKeys, setReviewStartingKeys] = useState<Set<string>>(() => new Set());
  const [reviewDialogKey, setReviewDialogKey] = useState<string>();
  const [removeReviewerTarget, setRemoveReviewerTarget] = useState<MyPullRequest>();
  const [removingReviewer, setRemovingReviewer] = useState(false);
  const [removeReviewerError, setRemoveReviewerError] = useState<string>();
  const [pendingDecisionKeys, setPendingDecisionKeys] = useState<Set<string>>(() => new Set());
  const pendingDecisionKeysRef = useRef(new Set<string>());

  const applyPage = useCallback((page: MyPullRequestPage) => {
    setPullRequests((current) => {
      const currentByKey = new Map(current.map((item) => [pullRequestKey(item), item]));
      const nextValues = (Array.isArray(page.values) ? page.values : []).map((item) => {
        const previous = currentByKey.get(pullRequestKey(item));
        const preservedReview = previous?.review?.status === "running"
          && previous.latestCommit === item.latestCommit
          && item.review == null
          ? previous.review
          : item.review;
        if (previous?.activity === "read" && previous.latestCommit === item.latestCommit) {
          return { ...item, activity: "read" as const, review: preservedReview };
        }
        return { ...item, review: preservedReview };
      });
      return sortPullRequests(nextValues);
    });
    if (page.lastUpdatedAt != null) {
      setLastSyncAt(page.lastUpdatedAt);
      setNow(page.lastUpdatedAt);
    }
  }, []);

  const aiReviewReady = aiSettings?.settings.provider !== null && aiSettings?.providers.some((provider) =>
    matchesSelectedAiProvider(aiSettings.settings, provider)
      && provider.available
      && provider.status === "connected"
      && provider.models.includes(aiSettings.settings.model),
  ) === true;

  useEffect(() => {
    return subscribeAppEvent(APP_EVENT.aiSettingsChanged, setAiSettings);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setAiSettings(null);
    const pagePromise = listMyPullRequests(0, 100).then((page) =>
      shouldRefreshPullRequestCache(page.lastUpdatedAt)
        ? refreshMyPullRequests(0, 100)
        : page,
    );
    void Promise.all([pagePromise, getPullRequestReviewSettings()])
      .then(([page, savedSettings]) => {
        if (!active) return;
        applyPage(page);
        setSettings(savedSettings ?? emptySettings);
      })
      .catch((reason) => {
        if (active) {
          setPullRequests([]);
          setError(commandError(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void getAiSettings()
      .then((savedAiSettings) => {
        if (active) setAiSettings(savedAiSettings);
      })
      .catch(() => {
        if (active) setAiSettings(null);
      });
    return () => {
      active = false;
    };
  }, [applyPage]);

  const syncPullRequests = useCallback(async () => {
    setPolling(true);
    setError(undefined);
    try {
      const page = await refreshMyPullRequests(0, 100);
      applyPage(page);
      emitAppEvent(APP_EVENT.pullRequestActivityChanged);
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setPolling(false);
    }
  }, [applyPage]);

  useEffect(() => {
    return subscribeAppEvent(APP_EVENT.reviewerPullRequestsUpdated, applyPage);
  }, [applyPage]);

  useEffect(() => {
    return subscribeAppEvent(APP_EVENT.pullRequestReviewChanged, ({ key, review }) => {
      setReviewStartingKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, review } : item,
      )));
    });
  }, []);

  usePullRequestReviewPolling(pullRequests, setPullRequests);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const reload = () => {
      const currentRevision = ++revision;
      void listMyPullRequests(0, 100).then((page) => {
        if (active && currentRevision === revision) applyPage(page);
      }).catch((reason) => {
        if (active && currentRevision === revision) setError(commandError(reason));
      });
    };
    const unsubscribeRules = subscribeAppEvent(APP_EVENT.reviewInstructionRulesChanged, reload);
    const unsubscribePrompts = subscribeAppEvent(APP_EVENT.aiPromptSettingsChanged, (value) => {
      if (value.action === "pullRequestReview" || value.action === "reviewArbiter") reload();
    });
    return () => { active = false; unsubscribeRules(); unsubscribePrompts(); };
  }, [applyPage]);

  useEffect(() => {
    const query = projectInput.trim();
    if (!settingsOpen || filterSearch !== "project" || query.length < 3) {
      setProjectSearchResults([]);
      setProjectSearchLoading(false);
      setProjectSearchError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setProjectSearchLoading(true);
      setProjectSearchError(undefined);
      searchBitbucketProjects(query)
        .then((repositories) => {
          if (active) setProjectSearchResults(repositories);
        })
        .catch((reason) => {
          if (active) {
            setProjectSearchResults([]);
            setProjectSearchError(commandError(reason));
          }
        })
        .finally(() => {
          if (active) setProjectSearchLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [projectInput, settingsOpen, filterSearch]);

  useEffect(() => {
    const query = repositoryInput.trim();
    if (!settingsOpen || filterSearch !== "repository" || query.length < 3) {
      setRepositorySearchResults([]);
      setRepositorySearchLoading(false);
      setRepositorySearchError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setRepositorySearchLoading(true);
      setRepositorySearchError(undefined);
      searchBitbucketRepositories(query)
        .then((repositories) => {
          if (active) setRepositorySearchResults(repositories);
        })
        .catch((reason) => {
          if (active) {
            setRepositorySearchResults([]);
            setRepositorySearchError(commandError(reason));
          }
        })
        .finally(() => {
          if (active) setRepositorySearchLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [repositoryInput, settingsOpen, filterSearch]);

  useEffect(() => {
    const query = creatorInput.trim();
    if (!settingsOpen || filterSearch !== "creator" || query.length < 3) {
      setCreatorSearchResults([]);
      setCreatorSearchLoading(false);
      setCreatorSearchError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setCreatorSearchLoading(true);
      setCreatorSearchError(undefined);
      searchBitbucketUsers(query)
        .then((users) => {
          if (active) setCreatorSearchResults(users);
        })
        .catch((reason) => {
          if (active) {
            setCreatorSearchResults([]);
            setCreatorSearchError(commandError(reason));
          }
        })
        .finally(() => {
          if (active) setCreatorSearchLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [creatorInput, settingsOpen, filterSearch]);

  const availableProjects = uniqueFilterTargets(projectSearchResults, (project) => project.projectKey).filter((project) =>
    !draftSettings[filterField(filterTab, "project")].some((value) => equalsIgnoreCase(value, project.projectKey)),
  );
  const availableRepositories = uniqueFilterTargets(repositorySearchResults, repositoryOptionKey).filter((repository) =>
    !draftSettings[filterField(filterTab, "repository")].some((value) => equalsIgnoreCase(value, repositoryOptionKey(repository))),
  );
  const availableCreators = uniqueFilterTargets(creatorSearchResults, creatorOptionValue).filter((user) => {
    const displayName = creatorOptionValue(user);
    return !!displayName && !draftSettings[filterField(filterTab, "creator")].some((value) => equalsIgnoreCase(value, displayName));
  });
  const repositorySearchMatch = availableRepositories.find((repository) =>
    equalsIgnoreCase(repositoryOptionKey(repository), repositoryInput),
  );
  const creatorSearchMatch = availableCreators.find((user) =>
    equalsIgnoreCase(creatorOptionValue(user) ?? "", creatorInput),
  );
  const filteredPullRequests = pullRequests.filter((pullRequest) => matchesSettings(pullRequest, settings));
  const visiblePullRequests = sortPullRequestsByUpdatedDate(
    filteredPullRequests.filter((pullRequest) =>
      quickFilter === "all" || pullRequest.myDecision === "not_reviewed",
    ),
    displayPreferences.sortOrder,
  );
  const groups = displayPreferences.grouping === "person"
    ? groupPullRequestsByPerson(visiblePullRequests)
    : groupPullRequestsByProject(visiblePullRequests);
  const reviewDialogPullRequest = reviewDialogKey
    ? pullRequests.find((pullRequest) => pullRequestKey(pullRequest) === reviewDialogKey)
    : undefined;
  const reviewDialogReview: PullRequestReviewState | undefined = reviewDialogPullRequest?.review;

  function openSettings() {
    setDraftSettings({
      filterMode: settings.filterMode,
      projectBlacklist: [...settings.projectBlacklist],
      projectWhitelist: [...settings.projectWhitelist],
      repositoryBlacklist: [...settings.repositoryBlacklist],
      creatorBlacklist: [...settings.creatorBlacklist],
      repositoryWhitelist: [...settings.repositoryWhitelist],
      creatorWhitelist: [...settings.creatorWhitelist],
      autoReviewEnabled: settings.autoReviewEnabled,
      authoredAutoReviewEnabled: settings.authoredAutoReviewEnabled,
    });
    setFilterTab(settings.filterMode === "allow" ? "whitelist" : "blacklist");
    setFilterSearch(undefined);
    setProjectInput("");
    setProjectSearchResults([]);
    setProjectSearchError(undefined);
    setRepositoryInput("");
    setRepositorySearchResults([]);
    setRepositorySearchError(undefined);
    setCreatorInput("");
    setCreatorSearchResults([]);
    setCreatorSearchError(undefined);
    setSettingsError(undefined);
    setSettingsOpen(true);
  }

  function addValue(kind: FilterKind, selectedValue?: string) {
    const field = filterField(filterTab, kind);
    const input = kind === "creator" ? creatorInput : kind === "project" ? projectInput : repositoryInput;
    const value = (selectedValue ?? input).trim();
    if (!value) return;
    setFilterSearch(undefined);
    setDraftSettings((current) => {
      if (current[field].some((existing) => equalsIgnoreCase(existing, value))) return current;
      return { ...current, [field]: [...current[field], value] };
    });
    if (kind === "project") setProjectInput("");
    else if (kind === "repository") setRepositoryInput("");
    else {
      setCreatorInput("");
      setCreatorSearchResults([]);
    }
  }

  function removeValue(kind: FilterKind, value: string) {
    const field = filterField(filterTab, kind);
    setDraftSettings((current) => ({
      ...current,
      [field]: current[field].filter((existing) => existing !== value),
    }));
  }

  const filterRulesChanged = (["projectBlacklist", "projectWhitelist", "repositoryBlacklist", "repositoryWhitelist", "creatorBlacklist", "creatorWhitelist"] as const)
    .some((field) => draftSettings[field].length !== settings[field].length
      || draftSettings[field].some((value) => !settings[field].some((saved) => equalsIgnoreCase(value, saved))));
  const selectedFilterMode = filterTab === "whitelist" ? "allow" : "deny";
  const filtersChanged = filterRulesChanged || selectedFilterMode !== settings.filterMode;

  async function saveSettings() {
    if (settingsWritePending.current || !filtersChanged) return;
    settingsWritePending.current = true;
    setSaving(true);
    setSettingsError(undefined);
    try {
      const saved = await savePullRequestReviewSettings({ ...draftSettings, filterMode: selectedFilterMode });
      setSettings(saved);
      setSettingsOpen(false);
      await syncPullRequests();
    } catch (reason) {
      setSettingsError(commandError(reason));
    } finally {
      settingsWritePending.current = false;
      setSaving(false);
    }
  }

  async function toggleAutoReview(enabled: boolean) {
    if (settingsWritePending.current) return;
    settingsWritePending.current = true;
    setAutoReviewSaving(true);
    setError(undefined);
    try {
      const saved = await savePullRequestReviewSettings({ ...settings, autoReviewEnabled: enabled });
      setSettings(saved);
      setDraftSettings((current) => ({ ...current, autoReviewEnabled: saved.autoReviewEnabled }));
    } catch (reason) {
      setError(t("pr.autoReviewSaveError", { error: commandError(reason) }));
    } finally {
      settingsWritePending.current = false;
      setAutoReviewSaving(false);
    }
  }

  async function blacklistPullRequest(pullRequest: MyPullRequest, scope: "project" | "repository" | "author") {
    if (settingsWritePending.current) return;
    const value = scope === "author" ? pullRequest.authorDisplayName : scope === "project" ? pullRequest.projectKey : repositoryKey(pullRequest);
    const field = scope === "author" ? "creatorBlacklist" : scope === "project" ? "projectBlacklist" : "repositoryBlacklist";
    const alreadyExcluded = settings[field].some((entry) => equalsIgnoreCase(entry, value));
    if (alreadyExcluded && settings.filterMode === "deny") return;
    settingsWritePending.current = true;
    setBlacklisting(true);
    setError(undefined);
    try {
      const saved = await savePullRequestReviewSettings({
        ...settings,
        filterMode: "deny",
        [field]: alreadyExcluded ? settings[field] : [...settings[field], value],
      });
      setSettings(saved);
      setDraftSettings(saved);
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      settingsWritePending.current = false;
      setBlacklisting(false);
    }
  }

  async function confirmRemoveReviewer() {
    const target = removeReviewerTarget;
    if (!target) return;
    setRemovingReviewer(true);
    setRemoveReviewerError(undefined);
    try {
      await removePullRequestReviewer(target, crypto.randomUUID());
      setRemoveReviewerTarget(undefined);
      await syncPullRequests();
    } catch (reason) {
      setRemoveReviewerError(commandError(reason));
    } finally {
      setRemovingReviewer(false);
    }
  }

  async function applyReviewDecision(target: MyPullRequest, action: "approve" | "needs_work") {
    setError(undefined);
    try {
      await updateReviewDecision(target, action);
    } catch (reason) {
      setError(commandError(reason));
    }
  }

  async function markRead(pullRequest: MyPullRequest) {
    const key = pullRequestKey(pullRequest);
    setError(undefined);
    try {
      const readState = await markPullRequestRead(
        pullRequest.integrationId,
        pullRequest.projectKey,
        pullRequest.repositorySlug,
        pullRequest.pullRequestId,
        pullRequest.latestCommit,
      );
      setPullRequests((current) => sortPullRequests(current.map((item) => pullRequestKey(item) === key ? { ...item, activity: readState.activity } : item)));
      emitAppEvent(APP_EVENT.pullRequestActivityChanged);
    } catch (reason) {
      setError(commandError(reason));
    }
  }

  async function markAllRead() {
    setReadAllPending(true);
    setError(undefined);
    try {
      await markAllPullRequestsRead();
      setPullRequests((current) => sortPullRequests(current.map((item) => ({ ...item, activity: "read" }))));
      emitAppEvent(APP_EVENT.pullRequestActivityChanged);
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setReadAllPending(false);
    }
  }

  async function startReview(pullRequest: MyPullRequest) {
    const key = pullRequestKey(pullRequest);
    if (!aiReviewReady) {
      setError(t("pr.aiProviderRequired"));
      return;
    }
    if (!pullRequest.url || !pullRequest.latestCommit) {
      setError(t("pr.reviewSourceMissing"));
      return;
    }
    setError(undefined);
    setReviewStartingKeys((current) => new Set(current).add(key));
    try {
      const review = await startPullRequestReview(pullRequest);
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, review } : item,
      )));
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setReviewStartingKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function publishReviewComment(pullRequest: MyPullRequest, comment: PullRequestPublishableComment) {
    try {
      return await publishPullRequestComment(pullRequest, comment);
    } catch (reason) {
      if (typeof reason === "object" && reason !== null && "code" in reason) {
        if (reason.code === "comment_comparison_failed") throw new Error(t("pr.dialog.publicationCheckError"));
        if (reason.code === "comment_discussion_changed") throw new Error(t("pr.dialog.discussionChanged"));
        if (reason.code === "reply_target_unavailable") throw new Error(t("pr.dialog.replyTargetUnavailable"));
      }
      throw new Error(commandError(reason));
    }
  }

  async function updateReviewDecision(pullRequest: MyPullRequest, action: "approve" | "needs_work") {
    const key = pullRequestKey(pullRequest);
    if (pendingDecisionKeysRef.current.has(key)) throw new Error(t("pr.dialog.decisionPending"));
    pendingDecisionKeysRef.current.add(key);
    setPendingDecisionKeys(new Set(pendingDecisionKeysRef.current));
    try {
      const status = await setPullRequestDecision(pullRequest, action);
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, myDecision: status.myDecision } : item,
      )));
      emitAppEvent(APP_EVENT.pullRequestActivityChanged);
    } catch (reason) {
      throw new Error(commandError(reason));
    } finally {
      pendingDecisionKeysRef.current.delete(key);
      setPendingDecisionKeys(new Set(pendingDecisionKeysRef.current));
    }
  }

  const activeProjectField = filterField(filterTab, "project");
  const activeRepositoryField = filterField(filterTab, "repository");
  const activeCreatorField = filterField(filterTab, "creator");
  const activeTabLabel = t(filterTab === "blacklist" ? "pr.filters.blacklist" : "pr.filters.whitelist");

  function renderPullRequest(pullRequest: MyPullRequest, showProjectKey: boolean) {
    const itemKey = pullRequestKey(pullRequest);
    return (
      <PullRequestListItem
        key={itemKey}
        pullRequest={pullRequest}
        mode="reviewer"
        aiReviewReady={aiReviewReady}
        reviewStarting={reviewStartingKeys.has(itemKey)}
        showProjectKey={showProjectKey}
        onOpenPullRequest={(item) => void markRead(item)}
        onMarkViewed={(item) => void markRead(item)}
        onStartReview={(item) => void startReview(item)}
        onBlacklistProject={(item) => void blacklistPullRequest(item, "project")}
        onBlacklistRepository={(item) => void blacklistPullRequest(item, "repository")}
        onBlacklistAuthor={(item) => void blacklistPullRequest(item, "author")}
        onCustomizeInstructions={(item, scope) => {
          const externalId = scope === "author" ? item.authorAccountName?.trim() : scope === "project" ? item.projectKey : repositoryKey(item);
          if (!externalId) return;
          setInstructionTarget({ integrationId: item.integrationId, scope, externalId, label: scope === "author" ? `${item.authorDisplayName} (${externalId})` : externalId });
          setInstructionsOpen(true);
        }}
        onRemoveReviewer={(item) => { setRemoveReviewerError(undefined); setRemoveReviewerTarget(item); }}
        onReviewDecision={(item, action) => { void applyReviewDecision(item, action); }}
        decisionPending={pendingDecisionKeys.has(itemKey)}
        filtersPending={settingsSaving}
        onOpenResults={(item) => {
          if (item.activity !== "read") void markRead(item);
          setReviewDialogKey(pullRequestKey(item));
        }}
      />
    );
  }

  return (
    <section aria-labelledby="pull-request-review-title" className="space-y-4">
      <PageHeader
        title={t("page.prsToReview")}
        titleId="pull-request-review-title"
        description={!loading && !error ? (
          <PullRequestStatus
            kind="review"
            count={filteredPullRequests.length}
            filterMode={settings.filterMode}
            activeFilterCount={settings.filterMode === "allow"
              ? settings.projectWhitelist.length + settings.repositoryWhitelist.length + settings.creatorWhitelist.length
              : settings.projectBlacklist.length + settings.repositoryBlacklist.length + settings.creatorBlacklist.length}
            sortOrder={displayPreferences.sortOrder}
            lastSyncAt={lastSyncAt}
            now={now}
            polling={polling}
          />
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={quickFilter} onValueChange={(value) => setQuickFilter(value as "all" | "pending")}>
          <SelectTrigger aria-label={t("pr.quickFilters.review")} className="h-9 text-[13.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pr.filter.all")}</SelectItem>
            <SelectItem value="pending">{t("pr.filter.pending")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("pr.permanentFilters")}
            title={t("pr.permanentFilters")}
            onClick={openSettings}
            disabled={loading || settingsSaving}
          >
            <Filter aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label={t("pr.instructions.title")} title={t("pr.instructions.title")} onClick={() => { setInstructionTarget(undefined); setInstructionsOpen(true); }} disabled={loading}>
            <FilePenLine aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("pr.displayOptions")}
            title={t("pr.displayOptions")}
            onClick={() => setDisplayOptionsOpen(true)}
            disabled={loading}
          >
            <Settings2 aria-hidden="true" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={polling ? t("pr.refreshing") : t("pr.refresh")}
            title={polling ? t("pr.refreshing") : t("pr.refresh")}
            onClick={() => void syncPullRequests()}
            disabled={loading || polling}
          >
            <RefreshCw className={polling ? "animate-spin" : undefined} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            actionTone="neutral"
            className="h-9 w-9"
            aria-label={t("pr.readAll")}
            title={t("pr.readAll")}
            onClick={() => void markAllRead()}
            disabled={loading || readAllPending || pullRequests.every((item) => item.activity === "read")}
          >
            {readAllPending ? <RefreshCw className="animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {loading ? <div role="status" aria-label={t("pr.loadingReview")}>{t("pr.loading")}</div> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("pr.reviewUnavailable")}</AlertTitle>
          <AlertDescription>{t("pr.reviewLoadError", { error })}</AlertDescription>
        </Alert>
      ) : null}
      {!loading && !error && pullRequests.length === 0 ? (
        <Card><CardContent className="px-4 py-3 text-sm text-muted-foreground"><p>{t("pr.emptyReview")}</p></CardContent></Card>
      ) : null}
      {!loading && !error && pullRequests.length > 0 && visiblePullRequests.length === 0 ? (
        <Card><CardContent className="px-4 py-3"><p className="text-sm text-muted-foreground">{t("pr.emptyFiltered")}</p></CardContent></Card>
      ) : null}

      <div className={`${displayPreferences.grouping !== "none" ? "space-y-5" : "inbox-list"} pt-1`} aria-live="polite">
        {displayPreferences.grouping !== "none"
          ? groups.map((group) => (
              <PullRequestProjectSection
                key={group.key}
                label={group.label}
                grouping={displayPreferences.grouping === "person" ? "person" : "project"}
                pullRequestCount={group.pullRequests.length}
                expandedByDefault={displayPreferences.expandProjectsByDefault}
                showSeparator
              >
                {group.pullRequests.map((pullRequest) => renderPullRequest(pullRequest, displayPreferences.grouping === "person"))}
              </PullRequestProjectSection>
            ))
          : visiblePullRequests.map((pullRequest) => renderPullRequest(pullRequest, true))}
      </div>

      <PullRequestReviewDialog
        open={Boolean(reviewDialogKey && (reviewDialogReview?.status === "failed" || (reviewDialogReview?.status === "completed" && reviewDialogReview.result)))}
        pullRequest={reviewDialogPullRequest}
        review={reviewDialogReview}
        reviewerActions
        onOpenChange={(open) => {
          if (!open) setReviewDialogKey(undefined);
        }}
        onOpenPullRequest={(item) => void markRead(item)}
        onRerunReview={(item) => void startReview(item)}
        onPublishComment={publishReviewComment}
        onSetDecision={reviewDialogKey && pendingDecisionKeys.has(reviewDialogKey) ? undefined : updateReviewDecision}
      />

      <AlertDialog open={Boolean(removeReviewerTarget)} onOpenChange={(open) => { if (!open && !removingReviewer) setRemoveReviewerTarget(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pr.actions.removeReviewer")}</AlertDialogTitle>
            <AlertDialogDescription>{t("pr.actions.removeReviewerDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          {removeReviewerError ? <p role="alert" className="text-sm text-destructive">{removeReviewerError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingReviewer}>{t("settings.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={removingReviewer} onClick={(event) => { event.preventDefault(); void confirmRemoveReviewer(); }}>{t("pr.actions.removeReviewerConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PullRequestDisplayOptionsDialog
        open={displayOptionsOpen}
        grouping={displayPreferences.grouping}
        expandProjectsByDefault={displayPreferences.expandProjectsByDefault}
        sortOrder={displayPreferences.sortOrder}
        autoReviewEnabled={settings.autoReviewEnabled}
        autoReviewDisabled={loading || settingsSaving}
        onOpenChange={setDisplayOptionsOpen}
        onApply={({ grouping, expandProjectsByDefault, sortOrder, autoReviewEnabled }) => {
          updateDisplayPreferences({ grouping, expandProjectsByDefault, sortOrder });
          if (autoReviewEnabled !== settings.autoReviewEnabled) void toggleAutoReview(autoReviewEnabled);
        }}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl" data-info-popover-boundary aria-describedby={undefined}>
          <DialogHeader>
            <div className="flex items-center gap-1.5 pr-6">
              <DialogTitle>{t("pr.filters.title")}</DialogTitle>
              <InfoPopover label={t("pr.filters.showHelp")} title={t("pr.filters.helpTitle")}>
                <p><strong className="font-medium text-foreground">{t("pr.filters.blacklist")}.</strong>{" "}{t("pr.filters.denyHint")}</p>
                <p><strong className="font-medium text-foreground">{t("pr.filters.whitelist")}.</strong>{" "}{t("pr.filters.allowHint")}</p>
                <p>{t("pr.filters.helpMatching")}</p>
                <p>{t("pr.filters.helpModes")}</p>
                <p>{t("pr.filters.helpSaving")}</p>
              </InfoPopover>
            </div>
          </DialogHeader>
          <ToggleGroup
            type="single"
            size="sm"
            role="radiogroup"
            value={filterTab}
            onValueChange={(value) => {
              if (value === "blacklist" || value === "whitelist") {
                setFilterSearch(undefined);
                setFilterTab(value);
              }
            }}
            aria-label={t("pr.filters.lists")}
            className="pr-filter-mode flex w-full shrink-0 justify-evenly gap-0 rounded-lg bg-muted py-1"
          >
            <ToggleGroupItem
              value="blacklist"
              title={t("pr.filters.denyHint")}
              className="pr-filter-mode-option px-4 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {t("pr.filters.blacklist")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="whitelist"
              title={t("pr.filters.allowHint")}
              className="pr-filter-mode-option px-4 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {t("pr.filters.whitelist")}
            </ToggleGroupItem>
          </ToggleGroup>

          <DialogBody layout="sections">
            <Card className="pr-filter-group shrink-0 overflow-hidden shadow-none">
              <CardHeader variant="section" className="px-3 py-1">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="min-w-0 flex-1 text-[15px] font-normal leading-normal">{t("pr.filters.projects")}</CardTitle>
                  <div className="flex shrink-0 items-center justify-end">
                    <PullRequestTargetPicker
                      open={settingsOpen && filterSearch === "project"}
                      onOpenChange={(open) => {
                        setFilterSearch((current) => open ? "project" : current === "project" ? undefined : current);
                        if (open) setProjectInput("");
                      }}
                      actionLabel={t("pr.filters.addProject")} inputId={`${filterTab}-project-input`} fieldLabel={t("pr.filters.project")}
                      query={projectInput} onQueryChange={setProjectInput} placeholder={t("pr.filters.projectPlaceholder")}
                      searching={projectSearchLoading} searchingLabel={t("pr.filters.searchingProjects")} error={projectSearchError} resultsLabel={t("pr.filters.projectResults")}
                      options={availableProjects.map((project) => ({ key: `${project.integrationId}:${project.projectKey}`, primary: project.projectKey, secondary: project.projectName, accessibleName: `${project.projectKey} (${project.projectName})` }))}
                      onSelect={(key) => { const project = availableProjects.find((candidate) => `${candidate.integrationId}:${candidate.projectKey}` === key); if (project) addValue("project", project.projectKey); }}
                    />
                  </div>
                </div>
              </CardHeader>
              {draftSettings[activeProjectField].length > 0 ? (
                <CardContent className="px-3 pb-0">
                  <ul aria-label={t("pr.filters.projectList", { list: activeTabLabel })} className="flex flex-col">
                    {draftSettings[activeProjectField].map((value) => (
                      <li key={value} className="flex min-h-10 min-w-0 items-center justify-between gap-3 border-b py-1.5 text-[13px] last:border-b-0">
                        <span className="min-w-0 break-words">{value}</span>
                        <div className="flex shrink-0 items-center justify-end">
                          <Button type="button" size="sm" variant="ghost" actionTone="delete" className="h-7 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive" aria-label={t("pr.filters.removeProject", { list: activeTabLabel, value })} onClick={() => removeValue("project", value)}>
                            <Trash2 data-icon="inline-start" aria-hidden="true" />{t("pr.filters.remove")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              ) : (
                <CardContent className="px-3 pb-2 pt-2">
                  <p className="text-[13px] text-muted-foreground">{t(filterTab === "whitelist" ? "pr.filters.emptyAllow" : "pr.filters.emptyDeny")}</p>
                </CardContent>
              )}
            </Card>

            <Card className="pr-filter-group shrink-0 overflow-hidden shadow-none">
              <CardHeader variant="section" className="px-3 py-1">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="min-w-0 flex-1 text-[15px] font-normal leading-normal">{t("pr.filters.repositories")}</CardTitle>
                  <div className="flex shrink-0 items-center justify-end">
                    <PullRequestTargetPicker
                      open={settingsOpen && filterSearch === "repository"}
                      onOpenChange={(open) => {
                        setFilterSearch((current) => open ? "repository" : current === "repository" ? undefined : current);
                        if (open) setRepositoryInput("");
                      }}
                      actionLabel={t("pr.filters.addRepository")} inputId={`${filterTab}-repository-input`} fieldLabel={t("pr.filters.repository")}
                      query={repositoryInput} onQueryChange={setRepositoryInput} placeholder={t("pr.filters.repositoryPlaceholder")}
                      searching={repositorySearchLoading} searchingLabel={t("pr.filters.searchingRepositories")} error={repositorySearchError} resultsLabel={t("pr.filters.repositoryResults")}
                      options={availableRepositories.map((repository) => ({ key: repositoryOptionKey(repository), primary: repositoryOptionKey(repository), secondary: `${repository.repositoryName} (${repository.projectName})`, accessibleName: repositoryOptionLabel(repository) }))}
                      onSelect={(key) => { addValue("repository", key); }}
                      onEnter={repositorySearchMatch ? () => addValue("repository", repositoryOptionKey(repositorySearchMatch)) : undefined}
                    />
                  </div>
                </div>
              </CardHeader>
              {draftSettings[activeRepositoryField].length > 0 ? (
                <CardContent className="px-3 pb-0">
                  <ul aria-label={t("pr.filters.repositoryList", { list: activeTabLabel })} className="flex flex-col">
                    {draftSettings[activeRepositoryField].map((value) => (
                      <li key={value} className="flex min-h-10 min-w-0 items-center justify-between gap-3 border-b py-1.5 text-[13px] last:border-b-0">
                        <span className="min-w-0 break-words">{value}</span>
                        <div className="flex shrink-0 items-center justify-end">
                          <Button type="button" size="sm" variant="ghost" actionTone="delete" className="h-7 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive" aria-label={t("pr.filters.removeRepository", { list: activeTabLabel, value })} onClick={() => removeValue("repository", value)}>
                            <Trash2 data-icon="inline-start" aria-hidden="true" />{t("pr.filters.remove")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              ) : (
                <CardContent className="px-3 pb-2 pt-2">
                  <p className="text-[13px] text-muted-foreground">{t(filterTab === "whitelist" ? "pr.filters.emptyAllow" : "pr.filters.emptyDeny")}</p>
                </CardContent>
              )}
            </Card>

            <Card className="pr-filter-group shrink-0 overflow-hidden shadow-none">
              <CardHeader variant="section" className="px-3 py-1">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="min-w-0 flex-1 text-[15px] font-normal leading-normal">{t("pr.filters.creators")}</CardTitle>
                  <div className="flex shrink-0 items-center justify-end">
                    <PullRequestTargetPicker
                      open={settingsOpen && filterSearch === "creator"}
                      onOpenChange={(open) => {
                        setFilterSearch((current) => open ? "creator" : current === "creator" ? undefined : current);
                        if (open) setCreatorInput("");
                      }}
                      actionLabel={t("pr.filters.addCreator")} inputId={`${filterTab}-creator-input`} fieldLabel={t("pr.filters.author")}
                      query={creatorInput} onQueryChange={setCreatorInput} placeholder={t("pr.filters.creatorPlaceholder")}
                      searching={creatorSearchLoading} searchingLabel={t("pr.filters.searchingCreators")} error={creatorSearchError} resultsLabel={t("pr.filters.creatorResults")}
                      options={availableCreators.map((user) => { const displayName = creatorOptionValue(user)!; const account = user.name ?? user.slug; return { key: `${user.name ?? ""}:${user.slug ?? ""}:${displayName}`, primary: displayName, secondary: account ? `(${account})` : undefined, accessibleName: `${displayName}${account ? ` (${account})` : ""}` }; })}
                      onSelect={(key) => { const user = availableCreators.find((candidate) => `${candidate.name ?? ""}:${candidate.slug ?? ""}:${creatorOptionValue(candidate)}` === key); if (user) addValue("creator", creatorOptionValue(user)); }}
                      onEnter={creatorSearchMatch ? () => addValue("creator", creatorOptionValue(creatorSearchMatch)) : undefined}
                    />
                  </div>
                </div>
              </CardHeader>
              {draftSettings[activeCreatorField].length > 0 ? (
                <CardContent className="px-3 pb-0">
                  <ul aria-label={t("pr.filters.creatorList", { list: activeTabLabel })} className="flex flex-col">
                    {draftSettings[activeCreatorField].map((value) => (
                      <li key={value} className="flex min-h-10 min-w-0 items-center justify-between gap-3 border-b py-1.5 text-[13px] last:border-b-0">
                        <span className="min-w-0 break-words">{value}</span>
                        <div className="flex shrink-0 items-center justify-end">
                          <Button type="button" size="sm" variant="ghost" actionTone="delete" className="h-7 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive" aria-label={t("pr.filters.removeCreator", { list: activeTabLabel, value })} onClick={() => removeValue("creator", value)}>
                            <Trash2 data-icon="inline-start" aria-hidden="true" />{t("pr.filters.remove")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              ) : (
                <CardContent className="px-3 pb-2 pt-2">
                  <p className="text-[13px] text-muted-foreground">{t(filterTab === "whitelist" ? "pr.filters.emptyAllow" : "pr.filters.emptyDeny")}</p>
                </CardContent>
              )}
            </Card>
            {settingsError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{t("pr.filters.saveError")}</AlertTitle>
                <AlertDescription>{settingsError}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button data-dialog-cancel type="button" variant="outline" onClick={() => setSettingsOpen(false)} disabled={saving}>{t("settings.common.cancel")}</Button>
            <Button type="button" actionTone="edit" onClick={() => void saveSettings()} disabled={settingsSaving || !filtersChanged}>{saving ? t("settings.common.saving") : t("settings.common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewInstructionsDialog initialTarget={instructionTarget} open={instructionsOpen} onOpenChange={setInstructionsOpen} />
    </section>
  );
}

import { invoke } from "@tauri-apps/api/core";

import type { ConfluenceSearchResponse, ConfluenceSpace } from "@/shared/contracts/confluence";

export const searchConfluence = (integrationId: string, query: string, limit = 20, spaceKey?: string) =>
  invoke<ConfluenceSearchResponse>("confluence_search", {
    request: { integrationId, query, limit, spaceKey },
  });

export const resolveConfluenceSpace = (integrationId: string, keyOrUrl: string) =>
  invoke<ConfluenceSpace>("confluence_space_resolve", {
    request: { integrationId, keyOrUrl },
  });

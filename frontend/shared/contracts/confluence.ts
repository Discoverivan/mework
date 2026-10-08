export interface ConfluenceSearchResult {
  id: string;
  title: string;
  contentType: string;
  spaceName?: string;
  excerpt?: string;
  url?: string;
  lastModified?: string;
}

export interface ConfluenceSearchResponse {
  integrationId: string;
  results: ConfluenceSearchResult[];
}

export interface ConfluenceSpace {
  integrationId: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
}

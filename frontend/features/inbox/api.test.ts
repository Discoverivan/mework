import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { listInbox } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("inbox API smoke test", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the typed inbox_list command", async () => {
    const query = { filter: "unread" as const, limit: 25, offset: 0 };
    await listInbox(query);

    expect(invoke).toHaveBeenCalledWith("inbox_list", { query });
  });
});

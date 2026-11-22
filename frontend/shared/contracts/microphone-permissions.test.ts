import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { ensureMicrophonePermission } from "./microphone-permissions";

describe("microphone permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
  });

  it("checks macOS permission and explicitly requests it when undetermined", async () => {
    invokeMock.mockResolvedValueOnce("notDetermined").mockResolvedValueOnce("authorized");

    await expect(ensureMicrophonePermission()).resolves.toBe("authorized");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "microphone_permission_status");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "microphone_request_permission");
  });
});

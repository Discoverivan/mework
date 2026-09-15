import { describe, expect, it, vi } from "vitest";
import { installAvailableUpdate } from "./update-install";

const { relaunchMock } = vi.hoisted(() => ({
  relaunchMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: relaunchMock,
}));

describe("installAvailableUpdate", () => {
  it("downloads the update before relaunching the application", async () => {
    const order: string[] = [];
    const update = {
      downloadAndInstall: vi.fn(async () => {
        order.push("download");
      }),
    };
    relaunchMock.mockImplementation(async () => {
      order.push("relaunch");
    });

    await installAvailableUpdate(update as never);

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(order).toEqual(["download", "relaunch"]);
  });
});

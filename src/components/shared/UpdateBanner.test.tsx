import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";

const { checkForAvailableUpdateMock, installAvailableUpdateMock } = vi.hoisted(() => ({
  checkForAvailableUpdateMock: vi.fn(),
  installAvailableUpdateMock: vi.fn(),
}));

vi.mock("./update-check", () => ({
  checkForAvailableUpdate: checkForAvailableUpdateMock,
}));

vi.mock("./update-install", () => ({
  installAvailableUpdate: installAvailableUpdateMock,
}));

describe("UpdateBanner", () => {
  it("does not show release notes and offers Update now", async () => {
    const update = {
      version: "0.1.5",
      body: "Internal release notes must not be shown here.",
    };
    checkForAvailableUpdateMock.mockResolvedValue(update);

    render(<UpdateBanner enabled />);

    expect(await screen.findByText("mework 0.1.5 is available")).toBeInTheDocument();
    expect(screen.getByText("A new version is ready to install.")).toBeInTheDocument();
    expect(screen.queryByText(update.body)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(installAvailableUpdateMock).toHaveBeenCalledWith(update));
  });
});

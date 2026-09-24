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
  it("shows the background-detected version and checks again only when the user installs", async () => {
    localStorage.clear();
    const update = {
      version: "0.1.5",
      body: "Internal release notes must not be shown here.",
    };
    checkForAvailableUpdateMock.mockResolvedValue(update);

    render(<UpdateBanner enabled updateVersion="0.1.5" />);

    expect(await screen.findByText("mework 0.1.5 is available")).toBeInTheDocument();
    expect(screen.getByText("A new version is ready to install.")).toBeInTheDocument();
    expect(screen.queryByText(update.body)).not.toBeInTheDocument();
    expect(checkForAvailableUpdateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(checkForAvailableUpdateMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(installAvailableUpdateMock).toHaveBeenCalledWith(update));
  });

  it("does not show the same detected release popup more than once", async () => {
    localStorage.clear();
    const first = render(<UpdateBanner enabled updateVersion="0.1.5" />);
    expect(await screen.findByText("mework 0.1.5 is available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    first.unmount();

    render(<UpdateBanner enabled updateVersion="0.1.5" />);
    expect(screen.queryByText("mework 0.1.5 is available")).not.toBeInTheDocument();
  });
});

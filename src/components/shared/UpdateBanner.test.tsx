import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";

const { checkForAvailableUpdateMock, installAvailableUpdateMock, loadAvailableUpdateReleaseNotesMock } = vi.hoisted(() => ({
  checkForAvailableUpdateMock: vi.fn(),
  installAvailableUpdateMock: vi.fn(),
  loadAvailableUpdateReleaseNotesMock: vi.fn(),
}));

vi.mock("@/release-notes", () => ({ loadAvailableUpdateReleaseNotes: loadAvailableUpdateReleaseNotesMock }));

vi.mock("./update-check", () => ({
  checkForAvailableUpdate: checkForAvailableUpdateMock,
}));

vi.mock("./update-install", () => ({
  installAvailableUpdate: installAvailableUpdateMock,
}));

describe("UpdateBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows the background-detected version and checks again only when the user installs", async () => {
    localStorage.clear();
    const update = {
      version: "0.1.5",
      body: "Internal release notes must not be shown here.",
    };
    checkForAvailableUpdateMock.mockResolvedValue(update);

    render(<UpdateBanner enabled updateVersion="0.1.5" developmentBuild={false} />);

    expect(await screen.findByText("New version 0.1.5 is available")).toBeInTheDocument();
    expect(screen.queryByText(update.body)).not.toBeInTheDocument();
    expect(checkForAvailableUpdateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(checkForAvailableUpdateMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(installAvailableUpdateMock).toHaveBeenCalledWith(update));
  });

  it("shows a development notice instead of checking or installing the update", async () => {
    render(<UpdateBanner enabled updateVersion="0.1.5" developmentBuild />);
    fireEvent.click(await screen.findByRole("button", { name: "Update" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This is mework-dev. Installing updates is not allowed in the development version.");
    expect(checkForAvailableUpdateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Update" })).toHaveAttribute("data-action-tone", "edit");
    loadAvailableUpdateReleaseNotesMock.mockResolvedValue([
      { version: "0.1.5", language: "en", markdown: "- Example newest change." },
      { version: "0.1.4", language: "en", markdown: "- Example earlier change." },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Release notes" }));
    expect(await screen.findByRole("heading", { name: "What's new" })).toBeInTheDocument();
    expect(loadAvailableUpdateReleaseNotesMock).toHaveBeenCalledWith("0.1.5", "en");
    expect(screen.getByText("Example newest change.").compareDocumentPosition(screen.getByText("Example earlier change.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(installAvailableUpdateMock).not.toHaveBeenCalled();
  });

  it("does not show the same detected release popup more than once", async () => {
    localStorage.clear();
    const first = render(<UpdateBanner enabled updateVersion="0.1.5" />);
    expect(await screen.findByText("New version 0.1.5 is available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    first.unmount();

    render(<UpdateBanner enabled updateVersion="0.1.5" />);
    expect(screen.queryByText("New version 0.1.5 is available")).not.toBeInTheDocument();
  });
});

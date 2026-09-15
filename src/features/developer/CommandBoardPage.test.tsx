import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandBoardPage } from "./CommandBoardPage";
import {
  deleteCommandBoardItem,
  listCommandBoardItems,
  runCommandBoardItem,
  saveCommandBoardItem,
} from "./command-board-api";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
vi.mock("./command-board-api", () => ({
  deleteCommandBoardItem: vi.fn(),
  listCommandBoardItems: vi.fn(),
  runCommandBoardItem: vi.fn(),
  saveCommandBoardItem: vi.fn(),
}));

const listMock = vi.mocked(listCommandBoardItems);
const saveMock = vi.mocked(saveCommandBoardItem);
const runMock = vi.mocked(runCommandBoardItem);
const deleteMock = vi.mocked(deleteCommandBoardItem);

const command = {
  id: "cmd-1",
  name: "Restart gateway",
  scriptPath: "/tmp/restart.command",
  arguments: "",
  workingDirectory: "/tmp",
};

describe("CommandBoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    listMock.mockResolvedValue([]);
    saveMock.mockResolvedValue(command);
    runMock.mockResolvedValue({ id: command.id, started: true });
    deleteMock.mockResolvedValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows an empty state and opens the add command dialog", async () => {
    render(<CommandBoardPage />);

    expect(await screen.findByText("No commands yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add command" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("placeholder");
    expect(screen.getByText("No script selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose script" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Selected script" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Launch command")).not.toBeInTheDocument();
  });

  it("saves a command with selected file and derived working directory", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("/tmp/tools/restart.command");
    render(<CommandBoardPage />);
    await screen.findByText("No commands yet");
    fireEvent.click(screen.getByRole("button", { name: "Add command" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose script" }));
    await waitFor(() => expect(screen.getByLabelText("Selected script")).toHaveTextContent("restart.command"));
    expect(open).toHaveBeenCalledWith({ directory: false, multiple: false });
    expect(screen.getByLabelText("Working directory (optional)")).toHaveValue("/tmp/tools");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Restart gateway" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      name: "Restart gateway",
      scriptPath: "/tmp/tools/restart.command",
      workingDirectory: "/tmp/tools",
    })));
    expect(await screen.findByRole("button", { name: "Run Restart gateway" })).toBeInTheDocument();
  });

  it("persists a selected card color from the overflow menu", async () => {
    listMock.mockResolvedValue([command]);
    saveMock.mockResolvedValue({ ...command, color: "blue" });
    render(<CommandBoardPage />);

    const card = await screen.findByRole("button", { name: "Run Restart gateway" });
    fireEvent.click(screen.getByRole("button", { name: "Command options for Restart gateway" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Card color for Restart gateway" }));
    fireEvent.click(await screen.findByRole("option", { name: "Blue" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      id: command.id,
      name: command.name,
      scriptPath: command.scriptPath,
      color: "blue",
    })));
    expect(card).toHaveClass("bg-blue-50");
  });

  it("runs cards and exposes edit/delete actions from the overflow menu", async () => {
    listMock.mockResolvedValue([command]);
    render(<CommandBoardPage />);
    const card = await screen.findByRole("button", { name: "Run Restart gateway" });
    fireEvent.click(card);
    await waitFor(() => expect(runMock).toHaveBeenCalledWith(command.id));

    fireEvent.click(screen.getByRole("button", { name: "Command options for Restart gateway" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue(command.name);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));

    fireEvent.click(screen.getByRole("button", { name: "Command options for Restart gateway" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(command.id));
    expect(screen.queryByRole("button", { name: "Run Restart gateway" })).not.toBeInTheDocument();
  });
});

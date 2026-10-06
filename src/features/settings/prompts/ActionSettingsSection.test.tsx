import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PromptSettings } from "@/shared/contracts/settings";
import { getPromptSettings, savePromptSettings } from "./api";
import { ActionSettingsSection } from "./ActionSettingsSection";

vi.mock("./api", () => ({ getCachedPromptSettings: vi.fn().mockReturnValue(null), getPromptSettings: vi.fn(), savePromptSettings: vi.fn() }));

const settings: PromptSettings = {
  action: "pullRequestReview", instructions: "Review concrete defects.", instructionsHash: "example-instructions-hash", defaultInstructions: "Review concrete defects.",
  protectedRules: "Return the required JSON object.", customized: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPromptSettings).mockResolvedValue([settings]);
  vi.mocked(savePromptSettings).mockImplementation(async (_, instructions) => ({ ...settings, instructions: instructions ?? settings.defaultInstructions, customized: instructions !== null }));
});

it("chooses custom instructions per action and switches back to the built-in prompt", async () => {
  const onSaved = vi.fn();
  render(<ActionSettingsSection onSaved={onSaved} />);
  const mode = await screen.findByRole("combobox", { name: "Instructions" });
  expect(mode).toHaveTextContent("Built-in");
  const view = screen.getByRole("button", { name: "View instructions: Pull request review" });
  expect(view.textContent).toBe("");
  expect(mode.closest('[role="group"]')).toContainElement(view);
  fireEvent.focus(view);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(/^View instructions$/);
  fireEvent.click(view);
  let dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Built-in prompt")).toHaveValue(settings.defaultInstructions);
  expect(dialog.getByLabelText("Built-in prompt")).toHaveAttribute("readonly");
  expect(dialog.getByLabelText("Application rules")).toHaveValue(settings.protectedRules);
  fireEvent.click(dialog.getByText("Close", { selector: "button" }));
  fireEvent.click(mode);
  fireEvent.click(screen.getByRole("option", { name: "Custom" }));
  dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Your instructions")).toHaveValue(settings.defaultInstructions);
  fireEvent.change(dialog.getByLabelText("Your instructions"), { target: { value: "Focus on API compatibility." } });
  expect(dialog.getByLabelText("Built-in prompt")).toHaveValue(settings.defaultInstructions);
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(savePromptSettings).toHaveBeenLastCalledWith("pullRequestReview", "Focus on API compatibility.");
  expect(mode).toHaveTextContent("Custom");
  expect(onSaved).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Edit instructions: Pull request review" }));
  dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Your instructions")).toHaveValue("Focus on API compatibility.");
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  fireEvent.click(mode);
  fireEvent.click(screen.getByRole("option", { name: "Built-in" }));
  await waitFor(() => expect(mode).toHaveTextContent("Built-in"));
  expect(savePromptSettings).toHaveBeenLastCalledWith("pullRequestReview", null);
});

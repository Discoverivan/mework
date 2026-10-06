import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { DataRetentionSettings } from "./DataRetentionSettings";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

it("loads retention settings and saves a changed history limit", async () => {
  const settings = { reviewHistoryDays: 90, syncHistoryDays: 30, removedTaskDays: 30 };
  invokeMock.mockImplementation(async (command, args) => command === "data_retention_settings" ? settings : args.settings);
  render(<I18nProvider><DataRetentionSettings /></I18nProvider>);
  const history = await screen.findByRole("textbox", { name: "PR review history (days)" });
  expect(history).toHaveValue("90");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(history, { target: { value: "" } });
  expect(history).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(history, { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("data_retention_settings_save", { settings: { ...settings, reviewHistoryDays: 30 } }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
});

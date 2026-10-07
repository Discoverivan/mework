import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { DataRetentionSettings } from "./DataRetentionSettings";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

it("loads retention settings and saves a changed history limit", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const settings = {
    reviewHistory: { value: 7, unit: "days" },
    syncHistory: { value: 7, unit: "days" },
    removedTasks: { value: 7, unit: "days" },
    diagnosticLogs: { value: 7, unit: "days" },
  };
  invokeMock.mockImplementation(async (command, args) => command === "data_retention_settings" ? settings : args.settings);
  render(<I18nProvider><DataRetentionSettings /></I18nProvider>);
  const history = await screen.findByRole("textbox", { name: "PR review history" });
  expect(history).toHaveValue("7");
  const logs = screen.getByRole("textbox", { name: "Diagnostic logs" });
  expect(logs).toHaveValue("7");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(history, { target: { value: "" } });
  expect(history).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(history, { target: { value: "30" } });
  fireEvent.click(screen.getByRole("combobox", { name: "PR review history unit" }));
  fireEvent.click(screen.getByRole("option", { name: "Hours" }));
  fireEvent.change(logs, { target: { value: "14" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("data_retention_settings_save", { settings: { ...settings, reviewHistory: { value: 30, unit: "hours" }, diagnosticLogs: { value: 14, unit: "days" } } }));
  expect(screen.getByRole("combobox", { name: "PR review history unit" })).toHaveTextContent("Hours");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
});

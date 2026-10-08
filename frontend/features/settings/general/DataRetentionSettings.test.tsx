import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { DataRetentionSettings } from "./DataRetentionSettings";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

it("loads retention settings and saves a changed history limit", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const settings = {
    reviewHistory: { mode: "period", value: 7, unit: "days" },
    syncHistory: { mode: "period", value: 7, unit: "days" },
    removedTasks: { mode: "period", value: 7, unit: "days" },
    diagnosticLogs: { mode: "period", value: 7, unit: "days" },
    diagnosticLogSizeLimit: { value: 100, unit: "mib" },
  };
  invokeMock.mockImplementation(async (command, args) => command === "data_retention_settings" ? settings : args.settings);
  render(<I18nProvider><DataRetentionSettings /></I18nProvider>);
  expect(screen.queryByRole("textbox", { name: "PR review history" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show retention settings" }));
  let history = await screen.findByRole("textbox", { name: "PR review history" });
  expect(history).toHaveValue("7");
  const compactWidth = history.style.width;
  let logs = screen.getByRole("textbox", { name: "Diagnostic logs" });
  expect(logs).toHaveValue("7");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.change(history, { target: { value: "" } });
  expect(history).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("textbox", { name: "PR review history" })).toHaveValue("7");
  const resetHistory = screen.getByRole("textbox", { name: "PR review history" });
  fireEvent.change(resetHistory, { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("textbox", { name: "PR review history" })).toHaveValue("7");
  expect(invokeMock).not.toHaveBeenCalledWith("data_retention_settings_save", expect.anything());
  history = screen.getByRole("textbox", { name: "PR review history" });
  logs = screen.getByRole("textbox", { name: "Diagnostic logs" });
  fireEvent.change(history, { target: { value: "30" } });
  expect(history.style.width).not.toBe(compactWidth);
  fireEvent.click(screen.getByRole("button", { name: "Hide retention settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Show retention settings" }));
  expect(screen.getByRole("textbox", { name: "PR review history" })).toHaveValue("30");
  fireEvent.change(history, { target: { value: "7" } });
  expect(history.style.width).toBe(compactWidth);
  fireEvent.change(history, { target: { value: "1234" } });
  expect(history).toHaveValue("1234");
  expect(history.style.width).not.toBe(compactWidth);
  fireEvent.click(screen.getByRole("combobox", { name: "PR review history unit" }));
  fireEvent.click(screen.getByRole("option", { name: "Hours" }));
  fireEvent.change(logs, { target: { value: "14" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Diagnostic logs retention" }));
  fireEvent.click(screen.getByRole("option", { name: "Keep indefinitely" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Diagnostic log size policy" }));
  fireEvent.click(screen.getByRole("option", { name: "No size limit" }));
  expect(screen.queryByRole("textbox", { name: "Total log size" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "Diagnostic log size policy" }));
  fireEvent.click(screen.getByRole("option", { name: "Limit total size" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Diagnostic log size unit" }));
  fireEvent.click(screen.getByRole("option", { name: "GiB" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Total log size" }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Removed tasks retention" }));
  fireEvent.click(screen.getByRole("option", { name: "Do not keep" }));
  expect(screen.getByRole("combobox", { name: "Removed tasks retention" })).toHaveAttribute(
    "data-tooltip", "Removes eligible history when saved. Current data and active runs remain available.",
  );
  expect(screen.queryByText("Removes eligible history when saved. Current data and active runs remain available.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("data_retention_settings_save", { settings: { ...settings,
    reviewHistory: { mode: "period", value: 1234, unit: "hours" },
    removedTasks: { ...settings.removedTasks, mode: "disabled" },
    diagnosticLogs: { mode: "indefinite", value: 14, unit: "days" }, diagnosticLogSizeLimit: { value: 2, unit: "gib" },
  } }));
  expect(screen.getByRole("combobox", { name: "PR review history unit" })).toHaveTextContent("Hours");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
});

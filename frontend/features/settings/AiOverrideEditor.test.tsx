import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import { AiOverrideEditor } from "./AiOverrideEditor";

it("applies advanced request limits to the same AI profile", () => {
  const onChange = vi.fn();
  render(<I18nProvider><AiOverrideEditor idPrefix="example-ai" disabled={false}
    profile={{ provider: "open-code-cli", model: "example/sample-model", reasoning: "medium", fastMode: false }}
    providers={[{ id: "open-code-cli", name: "OpenCode CLI", models: ["example/sample-model"], available: true, status: "connected" }]}
    inheritedLabel="Use defaults" providerLabel="Provider" modelLabel="Model" reasoningLabel="Reasoning"
    noModelsLabel="No models" unavailableLabel="Unavailable" onChange={onChange} /></I18nProvider>);

  fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  expect(dialog.getByRole("combobox", { name: "Model" })).toHaveTextContent("example/sample-model");
  fireEvent.click(dialog.getByRole("button", { name: "About the request timeout" }));
  expect(screen.getByText("Maximum time for a single API request or CLI run, including waiting, reasoning, and generation.")).toBeVisible();
  fireEvent.click(dialog.getByRole("button", { name: "About the request timeout" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "Request timeout" }), { target: { value: "30" } });
  expect(dialog.getByRole("button", { name: "Apply" })).toBeEnabled();
  fireEvent.change(dialog.getByRole("textbox", { name: "Request timeout" }), { target: { value: "15" } });
  expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  fireEvent.change(dialog.getByRole("textbox", { name: "Request timeout" }), { target: { value: "30" } });
  fireEvent.click(dialog.getByRole("combobox", { name: "Timeout unit" }));
  fireEvent.click(screen.getByRole("option", { name: "Hours" }));
  expect(dialog.getByRole("textbox", { name: "Request timeout" })).toHaveValue("0.5");
  fireEvent.click(dialog.getByRole("combobox", { name: "Output tokens" }));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Limit not set", "Limited"]);
  fireEvent.click(screen.getByRole("option", { name: "Limited" }));
  expect(dialog.getByRole("combobox", { name: "Output tokens" }).parentElement)
    .toContainElement(dialog.getByRole("textbox", { name: "Token count" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "Token count" }), { target: { value: "64000" } });
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));

  expect(onChange).toHaveBeenCalledWith({ provider: "open-code-cli", model: "example/sample-model", reasoning: "medium", fastMode: false,
    execution: { timeoutSeconds: 1800, maxOutputTokens: 64000, outputTokensMode: "limited" } });
});

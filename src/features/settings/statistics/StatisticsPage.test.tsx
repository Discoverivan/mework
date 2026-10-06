import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiUsageStatistics } from "./api";
import { StatisticsPage } from "./StatisticsPage";

const { getAiUsageStatisticsMock } = vi.hoisted(() => ({ getAiUsageStatisticsMock: vi.fn() }));

vi.mock("./api", () => ({ getAiUsageStatistics: getAiUsageStatisticsMock }));

const date = new Date();
const todayDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const todayStats: AiUsageStatistics = {
  period: "today",
  daily: [{ date: todayDate, providerId: "codex-cli", providerName: "Codex CLI", model: "gpt-5.5", inputTokens: 1500, outputTokens: 300, totalTokens: 1800 }],
  byModel: [{ providerId: "codex-cli", providerName: "Codex CLI", model: "gpt-5.5", requestCount: 3, inputTokens: 1500, outputTokens: 300, totalTokens: 1800 }],
  total: { requestCount: 3, inputTokens: 1500, outputTokens: 300, totalTokens: 1800 },
};

describe("StatisticsPage", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    getAiUsageStatisticsMock.mockReset();
    getAiUsageStatisticsMock.mockResolvedValue(todayStats);
  });

  it("shows request counts even when the provider reports zero tokens", async () => {
    getAiUsageStatisticsMock.mockResolvedValue({
      period: "today",
      daily: [],
      byModel: [{ providerId: "codex-cli", providerName: "Codex CLI", model: "example-model", requestCount: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 }],
      total: { requestCount: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    render(<StatisticsPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("example-model")).toBeInTheDocument();
    expect(within(table).getAllByText("1")).toHaveLength(2);
  });

  it("shows provider/model token totals and reloads when the period changes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 640, 320));
    render(<StatisticsPage />);

    expect(await screen.findByRole("heading", { name: "Statistics" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Reporting period" })).toHaveTextContent("Today");
    expect(screen.getByRole("img", { name: "Daily total tokens by provider and model" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("gpt-5.5")).toBeInTheDocument();
    expect(within(table).getByText("Codex CLI")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "IN" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "OUT" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Requests" })).toBeInTheDocument();
    expect(within(table).getAllByText("3")).toHaveLength(2);
    expect(within(table).getAllByText("1,500")).toHaveLength(2);
    expect(within(table).getAllByText("300")).toHaveLength(2);
    expect(within(table).getAllByText("1,800").length).toBeGreaterThan(0);

    fireEvent.keyDown(await screen.findByRole("application"), { key: "ArrowRight" });
    await waitFor(() => {
      const tooltip = document.querySelector<HTMLElement>(".recharts-tooltip-wrapper");
      expect(tooltip).toBeVisible();
      expect(tooltip).toHaveTextContent("1,800");
      expect(tooltip?.style.transform).toContain("translate(");
      expect(tooltip?.style.transition).toBe("");
    });
    await waitFor(() => {
      const tooltip = document.querySelector<HTMLElement>(".recharts-tooltip-wrapper");
      expect(tooltip?.style.transition).toBe("transform 400ms ease");
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Reporting period" }));
    expect(screen.getByRole("option", { name: "This month" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Last 7 days" }));
    expect(screen.getByRole("combobox", { name: "Reporting period" })).toHaveTextContent("Last 7 days");
    await waitFor(() => expect(getAiUsageStatisticsMock).toHaveBeenLastCalledWith("seven_days"));
  });
});

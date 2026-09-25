import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiUsageStatistics } from "./api";
import { StatisticsPage } from "./StatisticsPage";

const { getAiUsageStatisticsMock } = vi.hoisted(() => ({ getAiUsageStatisticsMock: vi.fn() }));

vi.mock("./api", () => ({ getAiUsageStatistics: getAiUsageStatisticsMock }));

const date = new Date();
const todayDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const todayStats: AiUsageStatistics = {
  period: "today",
  daily: [{ date: todayDate, providerId: "codex-cli", providerName: "Codex CLI", model: "gpt-5.5", inputTokens: 1500, outputTokens: 300, totalTokens: 1800 }],
  byModel: [{ providerId: "codex-cli", providerName: "Codex CLI", model: "gpt-5.5", inputTokens: 1500, outputTokens: 300, totalTokens: 1800 }],
  total: { inputTokens: 1500, outputTokens: 300, totalTokens: 1800 },
};

describe("StatisticsPage", () => {
  beforeEach(() => {
    getAiUsageStatisticsMock.mockReset();
    getAiUsageStatisticsMock.mockResolvedValue(todayStats);
  });

  it("shows provider/model token totals and reloads when the period changes", async () => {
    render(<StatisticsPage />);

    expect(await screen.findByRole("heading", { name: "Statistics" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Reporting period" })).toBeInTheDocument();
    const today = screen.getByRole("radio", { name: "Today" });
    expect(today).toHaveAttribute("aria-checked", "true");
    fireEvent.click(today);
    expect(today).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Last 7 days" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "This month" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Daily total tokens by provider and model" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("gpt-5.5")).toBeInTheDocument();
    expect(within(table).getByText("Codex CLI")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "IN" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "OUT" })).toBeInTheDocument();
    expect(within(table).getAllByText("1,500")).toHaveLength(2);
    expect(within(table).getAllByText("300")).toHaveLength(2);
    expect(within(table).getAllByText("1,800").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("radio", { name: "Last 7 days" }));
    await waitFor(() => expect(getAiUsageStatisticsMock).toHaveBeenLastCalledWith("seven_days"));
  });
});

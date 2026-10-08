import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplashScreen } from "./SplashScreen";

describe("SplashScreen", () => {
  it("keeps the original startup screen and progress bar until the workspace is ready", () => {
    const html = readFileSync("index.html", "utf8");
    const startup = new DOMParser().parseFromString(html, "text/html").getElementById("startup-splash")!;
    document.body.append(startup);
    const progress = startup.querySelector('[role="progressbar"]');
    const bar = startup.querySelector(".splash-progress-bar");
    const { rerender } = render(<SplashScreen visible />);

    try {
      expect(screen.getByRole("status", { name: "Loading mework" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "mework" })).toHaveAttribute("src", "/mework-icon.png");
      expect(screen.getByText("Loading mework")).toBeInTheDocument();
      expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Application loading" })).toBeInTheDocument();
      expect(screen.getAllByRole("img")).toHaveLength(1);
      expect(screen.getByRole("progressbar")).toBe(progress);
      expect(startup.querySelector(".splash-progress-bar")).toBe(bar);
      expect(document.querySelectorAll(".splash-screen")).toHaveLength(1);

      rerender(<SplashScreen visible={false} />);
      expect(startup).toHaveAttribute("hidden");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      startup.remove();
    }
  });
});

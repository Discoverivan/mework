import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplashScreen } from "./SplashScreen";

describe("SplashScreen", () => {
  it("shows only the app icon, name, and loading status", () => {
    render(<SplashScreen visible />);

    expect(screen.getByRole("status", { name: "Loading mework" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "mework" })).toHaveAttribute("src", "/mework-icon.png");
    expect(screen.getByText("Loading mework")).toBeInTheDocument();
    expect(screen.getByText("Checking integrations and AI providers…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Application loading" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});

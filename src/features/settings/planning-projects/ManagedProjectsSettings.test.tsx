import { describe, expect, it } from "vitest";

import { memberInitials, reorderMemberIdsAtInsertionIndex } from "./ManagedProjectsSettings";

describe("team member display", () => {
  it("uses the first letters of the first and last names for avatar fallback", () => {
    expect(memberInitials("Test Team Member")).toBe("TM");
  });

  it("inserts the dragged member into a gap before the first card", () => {
    expect(reorderMemberIdsAtInsertionIndex(["member-a", "member-b", "member-c"], "member-b", 0)).toEqual(["member-b", "member-a", "member-c"]);
  });
});

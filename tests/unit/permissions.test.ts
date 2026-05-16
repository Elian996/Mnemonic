import { describe, expect, it } from "vitest";
import { MnemonicSourceType, MnemonicStatus, UserRole } from "@prisma/client";
import { canEditMnemonic, canManageUsers, canReviewSubmissions, canViewMnemonic, hasRole } from "@/lib/permissions";

describe("permissions", () => {
  it("uses role hierarchy", () => {
    expect(hasRole({ role: UserRole.EDITOR }, UserRole.REVIEWER)).toBe(true);
    expect(canReviewSubmissions({ role: UserRole.REVIEWER })).toBe(true);
    expect(canManageUsers({ role: UserRole.EDITOR })).toBe(false);
  });

  it("allows owners to edit private/user entries", () => {
    expect(
      canEditMnemonic(
        { id: "u1", role: UserRole.USER },
        { authorId: "u1", sourceType: MnemonicSourceType.USER_PRIVATE }
      )
    ).toBe(true);
  });

  it("requires editors for official entries", () => {
    expect(
      canEditMnemonic(
        { id: "u1", role: UserRole.USER },
        { authorId: "u1", sourceType: MnemonicSourceType.OFFICIAL }
      )
    ).toBe(false);
  });

  it("only exposes private entries to their owner or admins", () => {
    const entry = {
      authorId: "owner",
      sourceType: MnemonicSourceType.USER_PRIVATE,
      status: MnemonicStatus.PRIVATE,
      isPublic: false
    };

    expect(canViewMnemonic({ id: "owner", role: UserRole.USER }, entry)).toBe(true);
    expect(canViewMnemonic({ id: "other", role: UserRole.USER }, entry)).toBe(false);
    expect(canViewMnemonic({ id: "admin", role: UserRole.ADMIN }, entry)).toBe(true);
  });
});

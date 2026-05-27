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

  it("lets ordinary users edit or delete only their own public user cards", () => {
    const ownPublicEntry = {
      authorId: "owner",
      sourceType: MnemonicSourceType.USER_PUBLIC
    };
    const otherPublicEntry = {
      authorId: "other",
      sourceType: MnemonicSourceType.USER_PUBLIC
    };

    expect(canEditMnemonic({ id: "owner", role: UserRole.USER }, ownPublicEntry)).toBe(true);
    expect(canEditMnemonic({ id: "owner", role: UserRole.USER }, otherPublicEntry)).toBe(false);
  });

  it("reserves cross-user public card edits and deletes for admins", () => {
    const otherPublicEntry = {
      authorId: "other",
      sourceType: MnemonicSourceType.USER_PUBLIC
    };

    expect(canEditMnemonic({ id: "reviewer", role: UserRole.REVIEWER }, otherPublicEntry)).toBe(
      false
    );
    expect(canEditMnemonic({ id: "editor", role: UserRole.EDITOR }, otherPublicEntry)).toBe(false);
    expect(canEditMnemonic({ id: "admin", role: UserRole.ADMIN }, otherPublicEntry)).toBe(true);
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

  it("exposes approved public user cards without granting edit rights", () => {
    const entry = {
      authorId: "owner",
      sourceType: MnemonicSourceType.USER_PUBLIC,
      status: MnemonicStatus.APPROVED,
      isPublic: true
    };
    const viewer = { id: "viewer", role: UserRole.USER };

    expect(canViewMnemonic(null, entry)).toBe(true);
    expect(canViewMnemonic(viewer, entry)).toBe(true);
    expect(canEditMnemonic(viewer, entry)).toBe(false);
  });
});

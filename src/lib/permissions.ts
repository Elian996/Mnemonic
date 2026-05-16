import { MnemonicEntry, MnemonicSourceType, User, UserRole } from "@prisma/client";

const roleRank: Record<UserRole, number> = {
  USER: 1,
  CONTRIBUTOR: 2,
  REVIEWER: 3,
  EDITOR: 4,
  ADMIN: 5
};

export function hasRole(user: Pick<User, "role"> | null | undefined, minimum: UserRole) {
  return !!user && roleRank[user.role] >= roleRank[minimum];
}

export function canManageWords(user: Pick<User, "role"> | null | undefined) {
  return hasRole(user, UserRole.EDITOR);
}

export function canReviewSubmissions(user: Pick<User, "role"> | null | undefined) {
  return hasRole(user, UserRole.REVIEWER);
}

export function canManageUsers(user: Pick<User, "role"> | null | undefined) {
  return hasRole(user, UserRole.ADMIN);
}

export function canCreatePublicSubmission(user: Pick<User, "role"> | null | undefined) {
  return hasRole(user, UserRole.USER);
}

export function canEditMnemonic(
  user: Pick<User, "id" | "role"> | null | undefined,
  entry: Pick<MnemonicEntry, "authorId" | "sourceType">
) {
  if (!user) return false;
  if (hasRole(user, UserRole.ADMIN)) return true;
  if (entry.sourceType === MnemonicSourceType.OFFICIAL) return hasRole(user, UserRole.EDITOR);
  return entry.authorId === user.id;
}

export function isPublicMnemonic(
  entry: Pick<MnemonicEntry, "sourceType" | "status" | "isPublic">
) {
  if (entry.status === "ARCHIVED") return false;
  if (entry.sourceType === MnemonicSourceType.OFFICIAL) return true;
  return (
    entry.sourceType === MnemonicSourceType.USER_PUBLIC &&
    entry.isPublic &&
    (entry.status === "APPROVED" || entry.status === "FEATURED")
  );
}

export function canViewMnemonic(
  user: Pick<User, "id" | "role"> | null | undefined,
  entry: Pick<MnemonicEntry, "authorId" | "sourceType" | "status" | "isPublic">
) {
  if (isPublicMnemonic(entry)) return true;
  if (entry.status === "ARCHIVED") return false;
  return canEditMnemonic(user, entry);
}

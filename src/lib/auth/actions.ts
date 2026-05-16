"use server";

import { redirect } from "next/navigation";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { loginSchema, registerSchema } from "@/lib/validators";

export async function loginAction(formData: FormData) {
  const redirectTo = safeRedirectPath(formData.get("next"));
  const parsed = loginSchema.safeParse({
    email: normalizeEmail(formData.get("email")),
    password: formData.get("password")
  });
  if (!parsed.success) redirect(loginUrl("invalid", redirectTo));

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    redirect(loginUrl("invalid", redirectTo));
  }
  if (user.status !== "ACTIVE") {
    redirect(loginUrl("suspended", redirectTo));
  }
  await createSession(user.id);
  redirect(redirectTo);
}

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse({
    email: normalizeEmail(formData.get("email")),
    username: normalizeText(formData.get("username")),
    displayName: normalizeText(formData.get("displayName")),
    password: formData.get("password")
  });
  if (!parsed.success) redirect("/register?error=invalid");

  const existingUsername = await prisma.user.findFirst({
    where: { username: { equals: parsed.data.username, mode: "insensitive" } },
    select: { id: true }
  });
  if (existingUsername) redirect("/register?error=duplicate");

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        role: UserRole.USER
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect("/register?error=duplicate");
    }
    throw error;
  }

  await createSession(user.id);
  redirect("/me");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function safeRedirectPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/me";
}

function loginUrl(error: "invalid" | "suspended", next: string) {
  const params = new URLSearchParams({ error });
  if (next !== "/me") params.set("next", next);
  return `/login?${params.toString()}`;
}

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeEmailVerificationCode, requestEmailVerificationCode, verificationErrorParam } from "@/lib/auth/email-verification";
import { emailVerificationRequestSchema, loginSchema, passwordResetSchema, registerSchema } from "@/lib/validators";

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
    displayName: normalizeText(formData.get("displayName")),
    password: formData.get("password"),
    verificationCode: normalizeText(formData.get("verificationCode"))
  });
  if (!parsed.success) redirect("/register?error=invalid");

  const existingEmail = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true }
  });
  if (existingEmail) redirect(registerUrl("duplicate", parsed.data.email));

  const verificationResult = await consumeEmailVerificationCode({
    email: parsed.data.email,
    purpose: "REGISTER",
    code: parsed.data.verificationCode
  });
  if (verificationResult !== "valid") {
    redirect(registerUrl(verificationErrorParam(verificationResult), parsed.data.email));
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        username: await generateUniqueUsername(parsed.data.email),
        displayName: parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        role: UserRole.USER
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(registerUrl("duplicate", parsed.data.email));
    }
    throw error;
  }

  await createSession(user.id);
  redirect("/me");
}

export async function requestRegisterCodeAction(formData: FormData) {
  const parsed = emailVerificationRequestSchema.safeParse({
    email: normalizeEmail(formData.get("email"))
  });
  if (!parsed.success) redirect("/register?error=invalid_email");

  const existingEmail = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true }
  });
  if (existingEmail) redirect(registerUrl("duplicate", parsed.data.email));

  const result = await requestEmailVerificationCode({
    email: parsed.data.email,
    purpose: "REGISTER",
    ip: await requestIp()
  });
  if (result === "rate_limited") redirect(registerUrl("rate_limited", parsed.data.email));
  if (result === "send_failed") redirect(registerUrl("send_failed", parsed.data.email));
  redirect(registerUrl("sent", parsed.data.email));
}

export async function requestPasswordResetCodeAction(formData: FormData) {
  const parsed = emailVerificationRequestSchema.safeParse({
    email: normalizeEmail(formData.get("email"))
  });
  if (!parsed.success) redirect("/forgot-password?error=invalid_email");

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true }
  });
  if (!user) redirect(passwordResetUrl("sent", parsed.data.email));

  const result = await requestEmailVerificationCode({
    email: parsed.data.email,
    purpose: "PASSWORD_RESET",
    ip: await requestIp()
  });
  if (result === "rate_limited") redirect(passwordResetUrl("rate_limited", parsed.data.email));
  if (result === "send_failed") redirect(passwordResetUrl("send_failed", parsed.data.email));
  redirect(passwordResetUrl("sent", parsed.data.email));
}

export async function resetPasswordAction(formData: FormData) {
  const parsed = passwordResetSchema.safeParse({
    email: normalizeEmail(formData.get("email")),
    verificationCode: normalizeText(formData.get("verificationCode")),
    password: formData.get("password")
  });
  if (!parsed.success) redirect("/forgot-password?error=invalid");

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, status: true }
  });
  if (!user) redirect(passwordResetUrl("code_invalid", parsed.data.email));
  if (user.status !== "ACTIVE") redirect(passwordResetUrl("suspended", parsed.data.email));

  const verificationResult = await consumeEmailVerificationCode({
    email: parsed.data.email,
    purpose: "PASSWORD_RESET",
    code: parsed.data.verificationCode
  });
  if (verificationResult !== "valid") {
    redirect(passwordResetUrl(verificationErrorParam(verificationResult), parsed.data.email));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.password) }
  });
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

async function generateUniqueUsername(email: string) {
  const localPart = email.split("@")[0] ?? "";
  const base =
    localPart
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "user";
  const normalizedBase = base.length >= 3 ? base : `user-${base}`;

  for (let index = 0; index < 50; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = `${normalizedBase.slice(0, 32 - suffix.length)}${suffix}`;
    const existingUser = await prisma.user.findFirst({
      where: { username: { equals: candidate, mode: "insensitive" } },
      select: { id: true }
    });
    if (!existingUser) return candidate;
  }

  return `user-${Date.now().toString(36)}`;
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

function registerUrl(error: string, email: string) {
  const params = new URLSearchParams({ error });
  if (email) params.set("email", email);
  return `/register?${params.toString()}`;
}

function passwordResetUrl(error: string, email: string) {
  const params = new URLSearchParams({ error });
  if (email) params.set("email", email);
  return `/forgot-password?${params.toString()}`;
}

async function requestIp() {
  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || headerStore.get("x-real-ip") || undefined;
}

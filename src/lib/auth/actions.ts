"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeEmailVerificationCode, requestEmailVerificationCode, verificationErrorParam } from "@/lib/auth/email-verification";
import { registerUrlWithState } from "@/lib/return-path";
import { clientIdentifierFromHeaders, clientIpFromHeaders } from "@/lib/security/client-ip";
import { checkRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { emailVerificationRequestSchema, loginSchema, passwordResetSchema, registerSchema } from "@/lib/validators";

export async function loginAction(formData: FormData) {
  const redirectTo = safeRedirectPath(formData.get("next"));
  const email = normalizeEmail(formData.get("email"));
  if (!(await checkAuthRateLimit("login:ip", await requestIdentifier(), 30, 5 * 60 * 1000))) {
    redirect(loginUrl("rate_limited", redirectTo));
  }
  const parsed = loginSchema.safeParse({
    email,
    password: formData.get("password")
  });
  if (!parsed.success) redirect(loginUrl("invalid", redirectTo));
  if (!(await checkAuthRateLimit("login:email", parsed.data.email, 10, 15 * 60 * 1000))) {
    redirect(loginUrl("rate_limited", redirectTo));
  }

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
  const redirectTo = safeRedirectPath(formData.get("next"));
  const parsed = registerSchema.safeParse({
    email: normalizeEmail(formData.get("email")),
    displayName: normalizeText(formData.get("displayName")),
    password: formData.get("password"),
    verificationCode: normalizeText(formData.get("verificationCode"))
  });
  if (!parsed.success) redirect(registerUrl("invalid", "", redirectTo));
  if (!(await checkAuthRateLimit("register:ip", await requestIdentifier(), 30, 10 * 60 * 1000))) {
    redirect(registerUrl("rate_limited", parsed.data.email, redirectTo));
  }

  const existingEmail = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true }
  });
  if (existingEmail) redirect(registerUrl("duplicate", parsed.data.email, redirectTo));

  const verificationResult = await consumeEmailVerificationCode({
    email: parsed.data.email,
    purpose: "REGISTER",
    code: parsed.data.verificationCode
  });
  if (verificationResult !== "valid") {
    redirect(registerUrl(verificationErrorParam(verificationResult), parsed.data.email, redirectTo));
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
      redirect(registerUrl("duplicate", parsed.data.email, redirectTo));
    }
    throw error;
  }

  await createSession(user.id);
  redirect(redirectTo);
}

export async function requestRegisterCodeAction(formData: FormData) {
  const redirectTo = safeRedirectPath(formData.get("next"));
  const parsed = emailVerificationRequestSchema.safeParse({
    email: normalizeEmail(formData.get("email"))
  });
  if (!parsed.success) redirect(registerUrl("invalid_email", "", redirectTo));
  const identifier = await requestIdentifier();
  if (
    !(await checkAuthRateLimit("register-code:ip", identifier, 12, 10 * 60 * 1000)) ||
    !(await checkAuthRateLimit("register-code:email", parsed.data.email, 5, 60 * 60 * 1000))
  ) {
    redirect(registerUrl("rate_limited", parsed.data.email, redirectTo));
  }

  const existingEmail = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true }
  });
  if (existingEmail) redirect(registerUrl("duplicate", parsed.data.email, redirectTo));

  const result = await requestEmailVerificationCode({
    email: parsed.data.email,
    purpose: "REGISTER",
    ip: await requestIp()
  });
  if (result === "rate_limited") redirect(registerUrl("rate_limited", parsed.data.email, redirectTo));
  if (result === "send_failed") redirect(registerUrl("send_failed", parsed.data.email, redirectTo));
  redirect(registerUrl("sent", parsed.data.email, redirectTo));
}

export async function requestPasswordResetCodeAction(formData: FormData) {
  const parsed = emailVerificationRequestSchema.safeParse({
    email: normalizeEmail(formData.get("email"))
  });
  if (!parsed.success) redirect("/forgot-password?error=invalid_email");
  const identifier = await requestIdentifier();
  if (
    !(await checkAuthRateLimit("password-reset-code:ip", identifier, 12, 10 * 60 * 1000)) ||
    !(await checkAuthRateLimit("password-reset-code:email", parsed.data.email, 5, 60 * 60 * 1000))
  ) {
    redirect(passwordResetUrl("rate_limited", parsed.data.email));
  }

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
  if (!(await checkAuthRateLimit("password-reset:ip", await requestIdentifier(), 30, 10 * 60 * 1000))) {
    redirect(passwordResetUrl("rate_limited", parsed.data.email));
  }

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

function loginUrl(error: "invalid" | "suspended" | "rate_limited", next: string) {
  const params = new URLSearchParams({ error });
  if (next !== "/me") params.set("next", next);
  return `/login?${params.toString()}`;
}

function registerUrl(error: string, email: string, next = "/me") {
  return registerUrlWithState(error, email, next);
}

function passwordResetUrl(error: string, email: string) {
  const params = new URLSearchParams({ error });
  if (email) params.set("email", email);
  return `/forgot-password?${params.toString()}`;
}

async function requestIp() {
  const headerStore = await headers();
  return clientIpFromHeaders(headerStore);
}

async function requestIdentifier() {
  const headerStore = await headers();
  return clientIdentifierFromHeaders(headerStore);
}

async function checkAuthRateLimit(scope: string, identifier: string, limit: number, windowMs: number) {
  return checkRateLimit({
    key: rateLimitKey(`auth:${scope}`, identifier),
    limit,
    windowMs
  }).allowed;
}

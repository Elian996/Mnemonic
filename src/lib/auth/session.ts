import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";

const COOKIE_NAME = "mnemonic_session";
const MAX_AGE = 60 * 60 * 24 * 30;
const SESSION_VERSION = 1;

type SessionPayload = {
  version: typeof SESSION_VERSION;
  userId: string;
  expiresAt: number;
};

export async function createSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, signSessionPayload({
    version: SESSION_VERSION,
    userId,
    expiresAt: Date.now() + MAX_AGE * 1000
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureSessionCookie(),
    maxAge: MAX_AGE,
    path: "/"
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  return getSessionUser();
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return null;

  return prisma.user.findFirst({
    where: {
      id: session.userId,
      status: "ACTIVE"
    }
  });
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login?error=required");
  return user;
}

export async function requireRole(role: UserRole) {
  const user = await requireUser();
  if (!hasRole(user, role)) redirect("/");
  return user;
}

export async function getUserWithRole(role: UserRole) {
  const user = await getSessionUser();
  if (!hasRole(user, role)) return null;
  return user;
}

function signSessionPayload(payload: SessionPayload) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signatureFor(encodedPayload)}`;
}

function verifySessionCookie(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) return null;
  if (!secureEqual(signature, signatureFor(encodedPayload))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (payload.version !== SESSION_VERSION || typeof payload.userId !== "string" || typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt < Date.now()) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

function signatureFor(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function shouldUseSecureSessionCookie() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return process.env.NODE_ENV === "production";

  try {
    return new URL(appUrl).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须配置 SESSION_SECRET。");
  }
  return "mnemonic-development-session-secret";
}

import "server-only";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_DAILY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;
const MAX_ATTEMPTS = 5;

export type EmailVerificationPurposeValue = "REGISTER" | "PASSWORD_RESET";
export type EmailVerificationResult = "sent" | "rate_limited" | "send_failed";
export type VerificationConsumeResult = "valid" | "missing" | "expired" | "locked" | "invalid";

export async function requestEmailVerificationCode(input: {
  email: string;
  purpose: EmailVerificationPurposeValue;
  ip?: string;
}) {
  const email = input.email.toLowerCase();
  const now = new Date();

  const recent = await prisma.emailVerificationCode.findFirst({
    where: {
      email,
      purpose: input.purpose,
      createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000) }
    },
    select: { id: true }
  });
  if (recent) return "rate_limited" satisfies EmailVerificationResult;

  const emailDailyCount = await prisma.emailVerificationCode.count({
    where: {
      email,
      purpose: input.purpose,
      createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
    }
  });
  if (emailDailyCount >= EMAIL_DAILY_LIMIT) return "rate_limited" satisfies EmailVerificationResult;

  if (input.ip) {
    const ipHourlyCount = await prisma.emailVerificationCode.count({
      where: {
        sentIp: input.ip,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) }
      }
    });
    if (ipHourlyCount >= IP_HOURLY_LIMIT) return "rate_limited" satisfies EmailVerificationResult;
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const verificationCode = await prisma.emailVerificationCode.create({
    data: {
      email,
      purpose: input.purpose,
      codeHash: hashVerificationCode(email, input.purpose, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000),
      sentIp: input.ip
    }
  });

  try {
    await sendVerificationEmail({ email, code, purpose: input.purpose });
    return "sent" satisfies EmailVerificationResult;
  } catch (error) {
    await prisma.emailVerificationCode.delete({ where: { id: verificationCode.id } }).catch(() => undefined);
    console.error("Failed to send verification email", error);
    return "send_failed" satisfies EmailVerificationResult;
  }
}

export async function consumeEmailVerificationCode(input: {
  email: string;
  purpose: EmailVerificationPurposeValue;
  code: string;
}) {
  const email = input.email.toLowerCase();
  const code = input.code.trim();
  const record = await prisma.emailVerificationCode.findFirst({
    where: {
      email,
      purpose: input.purpose,
      consumedAt: null
    },
    orderBy: { createdAt: "desc" }
  });

  if (!record) return "missing" satisfies VerificationConsumeResult;
  if (record.expiresAt.getTime() < Date.now()) return "expired" satisfies VerificationConsumeResult;
  if (record.attempts >= MAX_ATTEMPTS) return "locked" satisfies VerificationConsumeResult;

  const expected = hashVerificationCode(email, input.purpose, code);
  if (!secureEqual(record.codeHash, expected)) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } }
    });
    return record.attempts + 1 >= MAX_ATTEMPTS ? "locked" : "invalid";
  }

  await prisma.emailVerificationCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() }
  });
  return "valid" satisfies VerificationConsumeResult;
}

export function verificationErrorParam(result: VerificationConsumeResult) {
  if (result === "expired") return "code_expired";
  if (result === "locked") return "code_locked";
  return "code_invalid";
}

async function sendVerificationEmail(input: {
  email: string;
  code: string;
  purpose: EmailVerificationPurposeValue;
}) {
  const subject = input.purpose === "REGISTER" ? "Mnemonic 注册验证码" : "Mnemonic 密码重置验证码";
  const text = `你的 Mnemonic 验证码是 ${input.code}，${CODE_TTL_MINUTES} 分钟内有效。若非本人操作，请忽略本邮件。`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#111827">
      <p>你的 Mnemonic 验证码是：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${input.code}</p>
      <p>${CODE_TTL_MINUTES} 分钟内有效。若非本人操作，请忽略本邮件。</p>
    </div>
  `;

  if (shouldMockEmail()) {
    console.log(`[email:mock] to=${input.email} purpose=${input.purpose} code=${input.code}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM are required when email mock mode is disabled.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: input.email,
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${body}`);
  }
}

function shouldMockEmail() {
  if (process.env.EMAIL_MOCK === "true") return true;
  if (process.env.EMAIL_MOCK === "false") return false;
  return process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY;
}

function hashVerificationCode(email: string, purpose: EmailVerificationPurposeValue, code: string) {
  return crypto.createHmac("sha256", verificationSecret()).update(`${email}:${purpose}:${code}`).digest("base64url");
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verificationSecret() {
  if (process.env.EMAIL_VERIFICATION_SECRET) return process.env.EMAIL_VERIFICATION_SECRET;
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须配置 EMAIL_VERIFICATION_SECRET 或 SESSION_SECRET。");
  }
  return "mnemonic-development-email-verification-secret";
}

export function isDatabaseUnavailableError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return error instanceof Error && error.message.includes("Can't reach database server");
}

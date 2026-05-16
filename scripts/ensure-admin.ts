import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const email = requiredEnv("ADMIN_EMAIL").trim().toLowerCase();
  const password = requiredEnv("ADMIN_PASSWORD");
  const displayName = (process.env.ADMIN_DISPLAY_NAME ?? "Admin").trim() || "Admin";
  const requestedUsername = usernameFromEnvOrEmail(email);
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const user = await prisma.user.update({
      where: { email },
      data: {
        displayName,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
    console.log(`Admin account ready: ${user.email}`);
    return;
  }

  const username = await uniqueUsername(requestedUsername);
  const user = await prisma.user.create({
    data: {
      email,
      username,
      displayName,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  console.log(`Admin account ready: ${user.email}`);
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function usernameFromEnvOrEmail(email: string) {
  const raw = process.env.ADMIN_USERNAME ?? email.split("@")[0] ?? "admin";
  return raw.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "admin";
}

async function uniqueUsername(base: string) {
  let username = base;
  let suffix = 1;
  while (await prisma.user.findUnique({ where: { username } })) {
    const tail = `_${suffix}`;
    username = `${base.slice(0, 32 - tail.length)}${tail}`;
    suffix += 1;
  }
  return username;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_PORT = 3001;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const port = Number(getArgValue(args, "--port") ?? process.env.PORT ?? DEFAULT_PORT);
const host = "localhost";
const url = `http://${host}:${port}/`;
const shouldOpen = !args.includes("--no-open");
const shouldSkipDb = args.includes("--skip-db") || process.env.MNEMONIC_SKIP_DB === "1";
const prismaBin = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const nextBin = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}

if (shouldSkipDb) {
  console.log("Skipping local database setup.");
} else {
  await ensureDatabase();
}

await freePort(port);

const child = spawn(nextBin, ["dev", "--port", String(port)], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(port) },
  stdio: ["inherit", "pipe", "pipe"]
});

let opened = false;
let opening = false;

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  void openWhenReady();
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  void openWhenReady();
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
  }
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

void openWhenReady();

async function openWhenReady() {
  if (opened || opening) return;
  opening = true;

  try {
    await waitForHttp(url, 30_000);
    opened = true;
    console.log(`\nReady: ${url}`);
    if (shouldOpen) {
      await openUrl(url);
    }
  } catch {
    // Next may still be compiling; stdout/stderr activity will retry this check.
  } finally {
    opening = false;
  }
}

async function freePort(targetPort) {
  const pids = await getListenerPids(targetPort);
  if (!pids.length) return;

  console.log(`Port ${targetPort} is busy; stopping old process${pids.length > 1 ? "es" : ""}: ${pids.join(", ")}`);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }

  const released = await waitForPortRelease(targetPort, 3_000);
  if (released) return;

  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // The process may already have exited.
    }
  }

  await waitForPortRelease(targetPort, 2_000);
}

function getListenerPids(targetPort) {
  return new Promise((resolve) => {
    execFile("lsof", ["-tiTCP:" + targetPort, "-sTCP:LISTEN"], (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve([]);
        return;
      }
      resolve([...new Set(stdout.trim().split(/\s+/).filter(Boolean))]);
    });
  });
}

async function waitForPortRelease(targetPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = await getListenerPids(targetPort);
    if (!pids.length) return true;
    await sleep(150);
  }
  return false;
}

function waitForHttp(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(targetUrl, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });

      request.on("error", retry);
      request.setTimeout(1_000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${targetUrl}`));
        return;
      }
      setTimeout(attempt, 250);
    };

    attempt();
  });
}

function openUrl(targetUrl) {
  if (process.platform === "darwin") {
    return run("open", [targetUrl]);
  }
  if (process.platform === "win32") {
    return run("cmd", ["/c", "start", "", targetUrl]);
  }
  return run("xdg-open", [targetUrl]);
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function getArgValue(values, name) {
  const index = values.indexOf(name);
  return index === -1 ? undefined : values[index + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDatabase() {
  const databaseUrl = readDatabaseUrl();
  const databaseTarget = parseDatabaseTarget(databaseUrl);
  if (databaseUrl && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = databaseUrl;
  }

  console.log("Checking local database...");
  if (databaseTarget && (await canReachDatabaseTarget(databaseTarget, 1_000))) {
    console.log(`Database is reachable at ${databaseTarget.host}:${databaseTarget.port}.`);
    await preparePrismaDatabase();
    return;
  }

  if (!databaseTarget || !isLocalDatabaseHost(databaseTarget.host)) {
    const target = databaseTarget ? `${databaseTarget.host}:${databaseTarget.port}` : "DATABASE_URL";
    throw new Error(`Database target ${target} is not reachable. Start it, or run with --skip-db if this is intentional.`);
  }

  await ensureDockerDaemon();
  console.log("Starting local Postgres...");
  await runCommand("docker", ["compose", "up", "-d", "postgres"]);
  await waitForComposePostgres();
  await preparePrismaDatabase();
}

async function ensureDockerDaemon() {
  if (await commandSucceeds("docker", ["info"])) return;

  if (process.platform === "darwin" && existsSync("/Applications/Docker.app")) {
    console.log("Docker Desktop is not running; opening it now...");
    await run("open", ["-a", "Docker"]);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (await commandSucceeds("docker", ["info"])) return;
      await sleep(1_500);
    }
  }

  throw new Error("Docker is not running. Open Docker Desktop, wait until it finishes starting, then run npm run dev again.");
}

async function waitForComposePostgres() {
  console.log("Waiting for Postgres to accept connections...");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await commandSucceeds("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "mnemonic", "-d", "mnemonic"])) {
      return;
    }
    await sleep(1_000);
  }

  throw new Error("Postgres did not become ready in time.");
}

async function preparePrismaDatabase() {
  console.log("Preparing Prisma client and database schema...");
  await runCommand(prismaBin, ["generate"]);
  await runCommand(prismaBin, ["migrate", "deploy"]);
  await seedDatabaseIfEmpty();
}

async function seedDatabaseIfEmpty() {
  const count = await getWordCount();
  if (count > 0) {
    console.log(`Database already has ${count} words; skipping seed.`);
    return;
  }

  console.log("Database is empty; seeding starter content...");
  await runCommand(prismaBin, ["db", "seed"]);
}

async function getWordCount() {
  const script = `
    import { PrismaClient } from "@prisma/client";
    const prisma = new PrismaClient();
    try {
      const count = await prisma.word.count();
      process.stdout.write(String(count));
    } finally {
      await prisma.$disconnect();
    }
  `;
  const output = await runCapture(process.execPath, ["--input-type=module", "-e", script]);
  const count = Number.parseInt(output.trim(), 10);
  if (!Number.isFinite(count)) {
    throw new Error(`Unable to read word count from database: ${output.trim()}`);
  }
  return count;
}

function readDatabaseUrl() {
  return process.env.DATABASE_URL || readEnvValue(".env.local", "DATABASE_URL") || readEnvValue(".env", "DATABASE_URL") || "";
}

function readEnvValue(fileName, key) {
  const filePath = path.join(projectRoot, fileName);
  if (!existsSync(filePath)) return "";

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    if (trimmed.slice(0, equalsIndex).trim() !== key) continue;
    return unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim());
  }

  return "";
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseDatabaseTarget(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 5432)
    };
  } catch {
    return null;
  }
}

function isLocalDatabaseHost(value) {
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

async function canReachDatabaseTarget(target, timeoutMs) {
  if (target.host === "localhost") {
    return (
      (await canReachTcp("127.0.0.1", target.port, timeoutMs)) ||
      (await canReachTcp("::1", target.port, timeoutMs))
    );
  }
  return canReachTcp(target.host, target.port, timeoutMs);
}

function canReachTcp(targetHost, targetPort, timeoutMs) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: targetHost, port: targetPort });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function commandSucceeds(command, commandArgs) {
  return new Promise((resolve) => {
    execFile(command, commandArgs, { cwd: projectRoot }, (error) => {
      resolve(!error);
    });
  });
}

function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const commandProcess = spawn(command, commandArgs, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit"
    });
    commandProcess.on("error", reject);
    commandProcess.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${commandArgs.join(" ")} failed${signal ? ` with ${signal}` : ` with exit code ${code ?? 1}`}`));
    });
  });
}

function runCapture(command, commandArgs) {
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, { cwd: projectRoot, env: process.env, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_PORT = 3001;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const port = Number(getArgValue(args, "--port") ?? process.env.PORT ?? DEFAULT_PORT);
const host = "localhost";
const url = `http://${host}:${port}/`;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}

await freePort(port);

const nextBin = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
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
    await openUrl(url);
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

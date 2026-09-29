import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 15) {
  console.error(`Node.js >=24.15.0 <25 is required (detected ${process.version})`);
  process.exit(1);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedArgs = process.argv.slice(2);
const unknownArgs = requestedArgs.filter((argument) => argument !== "--mock");
if (unknownArgs.length > 0) {
  console.error(`Unsupported argument: ${unknownArgs.join(" ")}. The only optional argument is --mock.`);
  process.exit(1);
}
const mockMode = requestedArgs.includes("--mock");
const port = Number(process.env.MEWORK_MOCK_INTEGRATIONS_PORT || 18372);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("MEWORK_MOCK_INTEGRATIONS_PORT must be an integer from 1 to 65535");
  process.exit(1);
}
const childEnv = { ...process.env };
delete childEnv.MEWORK_DEV_MOCK_MODE;
delete childEnv.MEWORK_MOCK_INTEGRATION_ORIGIN;
if (mockMode) {
  childEnv.MEWORK_DEV_MOCK_MODE = "1";
  childEnv.MEWORK_MOCK_INTEGRATIONS_PORT = String(port);
  childEnv.MEWORK_MOCK_INTEGRATION_ORIGIN = `http://127.0.0.1:${port}`;
}
const tauriCli = path.join(repositoryRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
let simulator;
let tauri;

function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (tauri && tauri.exitCode === null) tauri.kill(signal);
    else stop(simulator);
  });
}

async function waitForSimulator(child, origin) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The mock integrations process exited before becoming ready");
    }
    try {
      const response = await fetch(`${origin}/__mock/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The sidecar can take a moment to bind after process startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the mock integrations service");
}

try {
  if (mockMode) {
    const build = spawnSync(
      "cargo",
      ["build", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "mework-mock-integrations", "--features", "dev-mock-rest"],
      { cwd: repositoryRoot, env: childEnv, stdio: "inherit" },
    );
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`Mock integrations build failed (${build.status ?? build.signal})`);

    const metadata = spawnSync(
      "cargo",
      ["metadata", "--manifest-path", "src-tauri/Cargo.toml", "--no-deps", "--format-version", "1"],
      { cwd: repositoryRoot, env: childEnv, encoding: "utf8" },
    );
    if (metadata.error) throw metadata.error;
    if (metadata.status !== 0) throw new Error("Unable to resolve Cargo target directory");
    const targetDirectory = JSON.parse(metadata.stdout).target_directory;
    const executable = path.join(
      targetDirectory,
      "debug",
      process.platform === "win32" ? "mework-mock-integrations.exe" : "mework-mock-integrations",
    );
    simulator = spawn(executable, [], { cwd: repositoryRoot, env: childEnv, stdio: "inherit" });
    await waitForSimulator(simulator, childEnv.MEWORK_MOCK_INTEGRATION_ORIGIN);
  }

  tauri = spawn(
    process.execPath,
    [
      tauriCli,
      "dev",
      "--config",
      "src-tauri/tauri.dev.conf.json",
      ...(mockMode ? ["--features", "dev-mock-rest"] : []),
      "--",
      "--bin",
      "mework-dev",
    ],
    { cwd: repositoryRoot, env: childEnv, stdio: "inherit" },
  );
  const exitCode = await new Promise((resolve, reject) => {
    tauri.on("error", reject);
    tauri.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error(`Unable to start development environment: ${error.message}`);
  process.exitCode = 1;
} finally {
  stop(tauri);
  stop(simulator);
}

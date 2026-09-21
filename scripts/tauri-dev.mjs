import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 15) {
  console.error(`Node.js >=24.15.0 <25 is required (detected ${process.version})`);
  process.exit(1);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = path.join(repositoryRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(
  process.execPath,
  [tauriCli, "dev", "--config", "src-tauri/tauri.dev.conf.json", "--", "--bin", "mework-dev"],
  { cwd: repositoryRoot, stdio: "inherit" },
);

child.on("error", (error) => {
  console.error(`Unable to start Tauri: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

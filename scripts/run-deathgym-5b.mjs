import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const workspace = path.resolve(import.meta.dirname, "..");
const root = path.resolve(
  workspace,
  "deliverables/taskmarket/TSK-E4RXQS7X/death-gym",
);
const python = path.join(root, ".venv/bin/python");
const destination = path.join(root, "local/checkpoints/long-5b");

const names = await readdir(destination).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
if (names.includes("final.safetensors")) {
  console.log(JSON.stringify({ status: "already-complete", targetSteps: 5_000_000_000 }));
  process.exit(0);
}
const resumable = names
  .map((name) => ({ name, step: Number(name.match(/^step(\d+)M\.safetensors$/)?.[1]) }))
  .filter((item) => Number.isFinite(item.step))
  .sort((a, b) => b.step - a.step);
const resume = resumable[0]
  ? path.join(destination, resumable[0].name)
  : null;

console.log(
  JSON.stringify({
    status: "starting",
    resume: resume ? path.relative(root, resume) : null,
    targetSteps: 5_000_000_000,
    runName: "long-5b",
  }),
);

const args = ["train.py"];
if (resume) args.push("--resume", path.relative(root, resume));
args.push(
  "--total-steps",
  "5000000000",
  "--checkpoint-every",
  "250000000",
  "--run-name",
  "long-5b",
);
const child = spawn(python, args, { cwd: root, stdio: "inherit" });

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}

const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (exitCode) => resolve(stopping ? 0 : (exitCode ?? 1)));
});
process.exitCode = code;

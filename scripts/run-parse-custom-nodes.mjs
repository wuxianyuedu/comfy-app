// scripts/run-parse-custom-nodes.mjs
// Loads .env / .env.local (so CUSTOM_NODES_PATH is honored), then spawns the
// Python AST parser. Read-only: never touches the scanned source files.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const paths = process.env.CUSTOM_NODES_PATH || "";
if (!paths.trim()) {
  console.error("[parse:custom-nodes] CUSTOM_NODES_PATH is empty — writing empty manifest.");
}

const out = "src/generated/customNodes.manifest.json";
const reportOut = "src/generated/customNodes.report.json";

const candidates = ["python3", "python", "py"];
let result = null;
for (const py of candidates) {
  result = spawnSync(py, ["scripts/parse_custom_nodes.py", "--paths", paths, "--out", out, "--report-out", reportOut], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error && result.error.code === "ENOENT") continue; // try next interpreter
  break;
}

if (result && result.error && result.error.code === "ENOENT") {
  console.error("[parse:custom-nodes] ERROR: no Python interpreter found (tried python3/python/py).");
  process.exit(1);
}
process.exit(result ? (result.status ?? 0) : 1);

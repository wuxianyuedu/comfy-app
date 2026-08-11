import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SuiteResult {
  name: string;
  pass: number;
  fail: number;
  skipped?: boolean;
}

/** Minimal test harness shared by every regression suite. */
export function makeSuite(name: string) {
  let pass = 0;
  let fail = 0;

  const check = (desc: string, cond: boolean, extra?: unknown) => {
    if (cond) {
      pass++;
      console.log(`  PASS  ${desc}`);
    } else {
      fail++;
      console.log(`  FAIL  ${desc}`, extra ?? "");
    }
  };

  const done = (): SuiteResult => {
    if (pass > 0 || fail > 0) {
      console.log(`\n[${name}] ${pass} passed, ${fail} failed`);
    }
    return { name, pass, fail };
  };

  return { check, done };
}

/** Aggregate results, print a summary table, return total failure count (exit code). */
export function summarize(results: SuiteResult[]): number {
  const real = results.filter((r) => !r.skipped);
  const totalPass = real.reduce((a, r) => a + r.pass, 0);
  const totalFail = real.reduce((a, r) => a + r.fail, 0);

  console.log("\n========================================");
  for (const r of results) {
    if (r.skipped) {
      console.log(`  SKIP   ${r.name} (no infra)`);
    } else {
      const ok = r.fail === 0;
      console.log(`  ${ok ? "PASS" : "FAIL"}   ${r.name}  (${r.pass}/${r.pass + r.fail})`);
    }
  }
  console.log("----------------------------------------");
  console.log(
    `  TOTAL: ${totalPass} passed, ${totalFail} failed` +
      (real.length === 0 ? " (all skipped)" : "")
  );
  console.log("========================================");
  return totalFail;
}

/**
 * True when the module whose `import.meta.url` is passed was run directly
 * (not imported by the orchestrator). Pass the caller's own metaUrl.
 */
export function isRunDirectly(metaUrl: string): boolean {
  const here = resolve(fileURLToPath(metaUrl));
  const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
  return !!invoked && here === invoked;
}

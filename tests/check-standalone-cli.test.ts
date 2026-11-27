/**
 * `pnpm check:standalone`（ISSUE #5194）：薄包装不另写判据、不收新旗标。
 */
import { describe, expect, it } from "vitest";

import { standaloneArgs } from "../scripts/gates/check-standalone-cli.mjs";

describe("standaloneArgs", () => {
  it("只透传既有判据路径，不认识的旗标当场拒绝", () => {
    expect(standaloneArgs([]).bad).toEqual([]);
    expect(standaloneArgs([]).args).toEqual(["scripts/gates/check-standalone-contents.cjs"]);
    expect(standaloneArgs(["--write"]).bad).toEqual(["--write"]);
  });
});

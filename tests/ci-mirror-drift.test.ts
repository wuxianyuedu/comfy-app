/** `scripts/ci-mirror-drift.mjs` 的判据与回读解析：两边一致 / 漂移 / 缺边，以及 ref 名必须逐字相同。 */
import { describe, expect, it } from "vitest";

import { judgeMirrorDrift } from "../scripts/ci-mirror-drift.mjs";
import { parseRemoteRefSha } from "../scripts/ci-mirror-push-verify.mjs";

const CNB = "a".repeat(40);
const GITHUB = "b".repeat(40);

describe("judgeMirrorDrift", () => {
  it("两边 master 逐字一致 ⇒ 0", () => {
    expect(judgeMirrorDrift({ cnbSha: CNB, githubSha: CNB })).toMatchObject({ code: 0 });
    expect(judgeMirrorDrift({ cnbSha: CNB, githubSha: CNB.toUpperCase() })).toMatchObject({
      code: 0,
    });
  });

  it("确认不等 ⇒ 1，两边 sha 都念出来", () => {
    const got = judgeMirrorDrift({ cnbSha: CNB, githubSha: GITHUB });
    expect(got.code).toBe(1);
    expect(got.note).toContain(`CNB master=${CNB}`);
    expect(got.note).toContain(`GitHub master=${GITHUB}`);
  });

  it("有一边读不到 ⇒ 2（没结论，不等于漂移）", () => {
    expect(judgeMirrorDrift({ cnbSha: null, githubSha: GITHUB })).toMatchObject({ code: 2 });
    expect(judgeMirrorDrift({ cnbSha: CNB, githubSha: null })).toMatchObject({ code: 2 });
    expect(judgeMirrorDrift({ cnbSha: CNB, githubSha: "" })).toMatchObject({ code: 2 });
    expect(judgeMirrorDrift({ cnbSha: "", githubSha: "" })).toMatchObject({ code: 2 });
  });
});

describe("parseRemoteRefSha（drift 的两边回读共用）", () => {
  it("只认指定 ref 的那一行", () => {
    expect(parseRemoteRefSha(`${CNB}\trefs/heads/master\n`, "refs/heads/master")).toBe(CNB);
    expect(
      parseRemoteRefSha(
        `${GITHUB}\trefs/heads/other\n${CNB}\trefs/heads/master\n`,
        "refs/heads/master",
      ),
    ).toBe(CNB);
  });

  it("错 ref 名（master-old）不许冒充 master", () => {
    expect(parseRemoteRefSha(`${CNB}\trefs/heads/master-old\n`, "refs/heads/master")).toBeNull();
    expect(parseRemoteRefSha(`${CNB} refs/heads/master-old`, "refs/heads/master")).toBeNull();
  });

  it("零行 / 只有空白 ⇒ null", () => {
    expect(parseRemoteRefSha("", "refs/heads/master")).toBeNull();
    expect(parseRemoteRefSha("\n  \n", "refs/heads/master")).toBeNull();
  });
});

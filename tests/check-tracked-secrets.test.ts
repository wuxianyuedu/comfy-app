/**
 * `scripts/check-tracked-secrets.cjs` 的判据（ISSUE #2157）。
 *
 * 这一族用例有两个方向，缺一不可：
 *   · **真命中**必须用拼接构造样本 —— 否则「测试文件里写着凭据形状」会先被自己扫出来
 *     （那条自指面在脚本文件头里写着，它是这条判据能存在的前提，不是可选的收紧）；
 *   · **负控制**才是这条判据的主体：`Bearer <token>`、PEM 头 + 短正文、CI 占位值、
 *     `user:pass@host` 那四类「看着像」的，今天全仓都在，任何一类误报的下一动作都是
 *     有人给这格加旁路，而旁路比没有判据更坏。
 * 最后一条判的是出口本身：命中时只许点名「哪儿 + 哪一类」，**不许回显内容** ——
 * 把密钥抄进输出就是第二次泄漏，而这件事只能被测出来一次才算数。
 */
import { describe, expect, it } from "vitest";

import {
  MIN_VALUE_CLASSES,
  charClasses,
  main,
  rowsOfText,
  scanInputs,
  scanText,
  toUnits,
  trackedTexts,
} from "../scripts/check-tracked-secrets.cjs";

/** 拼接出来的假凭据：文件文本里不存在任何一段完整的实体。 */
const FAKE_GHP = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FAKE_AKIA = "AKIA" + "I5JOEXAMPLEKEY4X";
const FAKE_SLACK = "xoxb-" + "7f2A9bQeRtY1uIoPaSdFgH";
const FAKE_AIZA = "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6q";
const FAKE_SK = "sk-" + "aB3xY9zQ2wErT6uIoPaS8dF1";
const FAKE_PEM_BODY = `MIIEpAIBAAKC${"a".repeat(64)}`;
const FAKE_ASSIGN_VALUE = "aB3-" + "xY9zQ2wErT6uIoPaS8dF";
const FAKE_BEARER = "Bearer " + "MDk2RElTabcdef01234567" + "89";
const FAKE_URL_PASS = "Sup3r" + "Secret99";

const shapesOf = (text: string) => scanText(text).map((h) => h.shape);

describe("前缀锚定类：出现即红（不看熵）", () => {
  const cases: Array<[string, string]> = [
    ["GitHub PAT（ghp_）", `const t = "${FAKE_GHP}";`],
    ["AWS access key id（AKIA…）", `aws=${FAKE_AKIA}`],
    ["Slack token（xox*）", `url: "${FAKE_SLACK}"`],
    ["Google API key（AIza…）", `key=${FAKE_AIZA}`],
    ["sk- 形态密钥（OpenAI / Stripe 一家）", `openai_key: ${FAKE_SK}`],
    ["Authorization bearer 实体", `Authorization: ${FAKE_BEARER}`],
  ];
  for (const [name, text] of cases) {
    it(`${name} ⇒ 命中`, () => {
      expect(shapesOf(text), text.slice(0, 24)).toContain(name);
    });
  }

  it("形状清单不会命中写它自己的那行源码（自指面）", () => {
    // 脚本与用例文件里都有这些字面正则；`--all` 那档要能扫过它们自己。
    expect(shapesOf("const PEM_BLOCK_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;")).toEqual([]);
    expect(shapesOf(String.raw`re: /\bghp_[0-9A-Za-z]{36,}\b/g`)).toEqual([]);
  });
});

describe("PEM：头 + 足够长的实体才算私钥", () => {
  it("真形态（头 + base64 实体跨行）⇒ 命中", () => {
    const text = `-----BEGIN RSA PRIVATE KEY-----\n${FAKE_PEM_BODY}\n-----END RSA PRIVATE KEY-----`;
    expect(shapesOf(text)).toContain("私钥实体（PEM 头 + base64 段）");
  });

  it("负控制：redaction 自己的假夹具（正文 6 字符）⇒ 不红", () => {
    expect(
      shapesOf("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----"),
    ).toEqual([]);
  });

  it("负控制：中文占位正文 ⇒ 不红", () => {
    expect(
      shapesOf("-----BEGIN PRIVATE KEY-----\n<示例私钥内容>\n-----END PRIVATE KEY-----"),
    ).toEqual([]);
  });

  it("相邻性：头与实体之间断开（不相邻的行）⇒ 不红 —— 拼段规则决定了它判什么", () => {
    const found = scanInputs([
      {
        file: "docs/x.md",
        rows: [
          { line: 10, text: "-----BEGIN RSA PRIVATE KEY-----" },
          { line: 40, text: FAKE_PEM_BODY },
        ],
      },
    ]);
    expect(found).toEqual([]);
    expect(
      toUnits([
        { line: 10, text: "a" },
        { line: 40, text: "b" },
      ]),
    ).toHaveLength(2);
  });
});

describe("赋值式：长度与字符类别两道都要过", () => {
  it("键名点明凭据 + 值够长够杂 ⇒ 命中", () => {
    expect(shapesOf(`API_KEY: "${FAKE_ASSIGN_VALUE}"`)).toContain(
      "赋值式凭据（键名含 SECRET / TOKEN / KEY / PASSWORD）",
    );
  });

  it("负控制：CI 占位值（全小写 + 连字符 = 只有两类）⇒ 不红", () => {
    const line = 'BETTER_AUTH_SECRET: "ci-placeholder-secret-not-for-production-use"';
    expect(charClasses("ci-placeholder-secret-not-for-production-use")).toBeLessThan(
      MIN_VALUE_CLASSES,
    );
    expect(shapesOf(line)).toEqual([]);
  });

  it("负控制：尖括号模板值（三类齐但形状是模板）⇒ 不红", () => {
    expect(shapesOf('API_KEY: "<ReplaceWithYourActualKey123456>"')).toEqual([]);
  });

  it("负控制：值太短 ⇒ 不红", () => {
    expect(shapesOf('SECRET: "aB3-xY9"')).toEqual([]);
  });
});

describe("URL 内嵌凭据", () => {
  it("真口令 ⇒ 命中", () => {
    expect(shapesOf(`endpoint: https://admin:${FAKE_URL_PASS}@10.0.0.5:8188/history`)).toContain(
      "URL 内嵌凭据",
    );
  });

  it("负控制：教学写法（user:pass@host / user:password@host）⇒ 不红", () => {
    expect(shapesOf("https://user:pass@host/x")).toEqual([]);
    expect(shapesOf("https://user:password@host/x")).toEqual([]);
  });

  it("负控制：占位口令 ⇒ 不红", () => {
    expect(shapesOf("https://user:<token>@localhost:3100")).toEqual([]);
  });

  it("负控制：模板形态的口令（`${TOKEN}` / `{{ token }}`）⇒ 不红 —— 真泄漏落的是展开后的值", () => {
    expect(shapesOf("url = `https://admin:${DATABASE_PASSWORD}@db.internal:3306`")).toEqual([]);
    expect(shapesOf("endpoint: https://user:{{ token }}@host/x")).toEqual([]);
  });
});

describe("出口：只点名位置与形状，绝不回显内容", () => {
  it("命中时输出里没有那串凭据，而有文件:行与形状名", () => {
    let out = "";
    const code = main(["--staged"], {
      stagedLines: () =>
        new Map([
          [
            "docs/standards/13-提交与-code-review.md",
            [
              { line: 88, text: `示例：${FAKE_GHP}` },
              { line: 89, text: `Authorization: ${FAKE_BEARER}` },
            ],
          ],
        ]),
      write: (s: string) => {
        out += s;
      },
    });
    expect(code).toBe(1);
    expect(out).toContain("docs/standards/13-提交与-code-review.md:88");
    expect(out).toContain("GitHub PAT（ghp_）");
    expect(out).toContain("Authorization bearer 实体");
    // 这一条是本判据的全部风险面：泄漏不需要一个判据来批准。
    expect(out).not.toContain("A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");
    expect(out).not.toContain("MDk2RElTabcdef01234567");
    expect(out).not.toContain("Bearer");
  });

  it("scanText 的返回形状里没有内容（偏移 + 形状名而已）", () => {
    const hits = scanText(`x = "${FAKE_GHP}"`);
    expect(JSON.stringify(hits)).not.toContain("A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");
    expect(hits[0]).toHaveProperty("shape");
    expect(hits[0]).not.toHaveProperty("text");
    expect(hits[0]).not.toHaveProperty("matched");
  });

  it("出路那段只教「怎么写占位」，不含任何跳过旗标", () => {
    let out = "";
    main(["--staged"], {
      stagedLines: () => new Map([["a.md", [{ line: 1, text: `key: ${FAKE_SK}` }]]]),
      write: (s: string) => {
        out += s;
      },
    });
    expect(out).toContain("已 gitignore");
    expect(out).not.toContain("--no-verify");
  });
});

describe("输入面：拿不到就不许念成「没命中」", () => {
  it("缺省那一档 = 全量档 ⇒ 读 all 那一面，而不是报「输入面不明」（注册表在平台会剥掉 --staged）", () => {
    let out = "";
    let stagedCalled = 0;
    let allCalled = 0;
    expect(
      main([], {
        stagedLines: () => {
          stagedCalled += 1;
          return new Map();
        },
        allTexts: () => {
          allCalled += 1;
          return {
            texts: [{ file: "docs/x.md", text: "示例：<你的 token>" }],
            unreadable: [],
          };
        },
        write: (s: string) => {
          out += s;
        },
      }),
    ).toBe(0);
    expect(allCalled).toBe(1);
    expect(stagedCalled).toBe(0);
    expect(out).toContain("全仓被跟踪文本");
    // 这条钉的是当场那次 CI 红：`--staged` 被剥掉后曾退 2，重档那一格报「5/55 红」。
    expect(out).not.toContain("没有结论");
  });

  it("输入面取不到（git 不可用 / 不在检出里）⇒ 退 2，并明说「不构成结论」", () => {
    let out = "";
    expect(
      main(["--staged"], {
        stagedLines: () => {
          throw new Error("not a git repository");
        },
        write: (s: string) => {
          out += s;
        },
      }),
    ).toBe(2);
    expect(out).toContain("不构成结论");
    expect(out).not.toContain("没有凭据形状");
  });

  it("暂存档没有新增行 ⇒ 退 0 且明说「这不是已通过」", () => {
    let out = "";
    expect(
      main(["--staged"], {
        stagedLines: () => new Map(),
        write: (s: string) => {
          out += s;
        },
      }),
    ).toBe(0);
    expect(out).toContain("这不是「已通过」");
  });

  it("读不到的文件单独点名，不进分母、也不冒充读过", () => {
    let out = "";
    expect(
      main(["--all"], {
        allTexts: () => ({ texts: [], unreadable: ["a/b.bin", "c/d.bin"] }),
        write: (s: string) => {
          out += s;
        },
      }),
    ).toBe(0);
    expect(out).toContain("另有 2 份读不到");
    expect(out).toContain("这一格的分母里");
  });
});

describe("真仓自证：今天的存量与那个分母", () => {
  it("全仓被跟踪文本 0 命中，且分母不是空（排除名单没把整个仓排掉）", () => {
    const { texts } = trackedTexts();
    expect(
      scanInputs(texts.map((t) => ({ file: t.file, rows: rowsOfText(t.text) }))),
      "今天全仓有命中 —— 这条判据「0 命中的存量」前提已经变了，先立案再改判据（§13.10.9）",
    ).toEqual([]);
    expect(texts.length).toBeGreaterThan(2000);
  });
});

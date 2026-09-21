import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  derivePortFromPath,
  FALLBACK_PORT,
  fnv1a32,
  normalizeRootForPort,
  readEnvFileValue,
  readEnvPort,
  resolveAppPort,
  resolveAppPortWithSource,
} from "../scripts/app-port.mjs";

/**
 * 应用端口解析契约（launch-and-build.md §1.1 / §1.4 多检出并行）。
 *
 * 推导算法是多语言约定（PowerShell / Python / Rust 各有同型实现），这里锁住
 * Node 侧行为与固定校验向量——向量由真实路径生成，四侧实现对同一输入必须
 * 得出同一端口，改动算法前先想清楚多检出并行会怎么被破坏。
 */
describe("app-port 端口解析", () => {
  it("路径规范化：反斜杠转正斜杠 + 转小写 + resolve", () => {
    expect(normalizeRootForPort("F:\\AI\\Other\\comfy-app-t3-branch")).toBe(
      "f:/ai/other/comfy-app-t3-branch",
    );
  });

  it("FNV-1a 32 位对固定输入给出稳定向量（跨语言一致性锚点）", () => {
    expect(fnv1a32("f:/ai/other/comfy-app-t3-branch")).toBe(0x97ecb3a9);
  });

  it("按检出路径推导的端口落在 3200..3999，且同路径恒定、异路径可分", () => {
    const a = derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch");
    const again = derivePortFromPath("F:/AI/Other/comfy-app-t3-branch");
    const b = derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch2");
    expect(a).toBe(3305);
    expect(again).toBe(a); // 同一检出（分隔符/大小写差异）必须同一端口
    expect(b).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(3200);
    expect(a).toBeLessThanOrEqual(3999);
  });

  it(".env 显式 COMFYAPP_PORT 优先于路径推导", () => {
    // 本仓库真实的 .env 显式钉了 COMFYAPP_PORT（开发者的主检出保持 3100），
    // 因此这里用临时目录造 .env 验证优先级，不依赖仓库当前配置。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-"));
    try {
      fs.writeFileSync(path.join(tmp, ".env"), 'COMFYAPP_PORT="4321"\n', "utf8");
      expect(readEnvPort(tmp)).toBe(4321);
      expect(resolveAppPort(tmp)).toBe(4321);

      fs.writeFileSync(path.join(tmp, ".env"), "COMFYAPP_PORT=not-a-number\n", "utf8");
      expect(readEnvPort(tmp)).toBeNull();
      expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));

      fs.writeFileSync(path.join(tmp, ".env"), "", "utf8");
      expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("规范化与 cwd 无关：绝对路径原样处理，不拼当前工作目录", () => {
    // 回归锁：历史实现无条件 path.resolve()，而它的语义是「相对 cwd 解析」——
    // 在 Linux 上 path.resolve("F:\\AI\\...") 会得到 /workspace/f:/ai/...，
    // 同一检出在不同 cwd / 不同平台推出不同端口，「同一检出恒定同端口」失效。
    const win = "F:\\AI\\Other\\comfy-app-t3-branch";
    const cwd = process.cwd();
    try {
      process.chdir(os.tmpdir());
      expect(normalizeRootForPort(win)).toBe("f:/ai/other/comfy-app-t3-branch");
      expect(derivePortFromPath(win)).toBe(3305);
    } finally {
      process.chdir(cwd);
    }
    // 回到本仓库 cwd 后仍是同一个值。
    expect(normalizeRootForPort(win)).toBe("f:/ai/other/comfy-app-t3-branch");
  });

  it("尾斜杠与分隔符写法不影响端口（POSIX 检出同样稳定）", () => {
    expect(normalizeRootForPort("/workspace/")).toBe("/workspace");
    expect(derivePortFromPath("/workspace/")).toBe(derivePortFromPath("/workspace"));
  });

  it("端口来源可归因（.env / 路径推导 / 兜底）", () => {
    // 只给数字的解析在「dev server 在 3100、壳在等 3809」时归不了因：看不出是
    // .env 写的还是路径推出来的，而这两种情况的修法完全不同（ISSUE #821）。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-src-"));
    try {
      expect(resolveAppPortWithSource(tmp)).toEqual({
        port: derivePortFromPath(tmp),
        source: "derived",
      });
      fs.writeFileSync(path.join(tmp, ".env"), "COMFYAPP_PORT=4321\n", "utf8");
      expect(resolveAppPortWithSource(tmp)).toEqual({ port: 4321, source: "env" });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(".env 单值解析：形态与另三侧严格对齐（成对引号 / 行尾注释 / 注释行）", () => {
    // 四侧读的是同一份 .env（Node / PowerShell / Python / Rust）。任一侧对下面
    // 任一形态的理解不一致，用户写死的端口就只对一部分进程可见，剩下的按路径
    // 推导去等另一个端口 —— 现象是启动页卡在「等 dev server」（ISSUE #821）。
    // 逐条与 tests/fixtures/app-port-vectors.json 的 envVectors 同源。
    expect(readEnvFileValue("COMFYAPP_PORT=3100", "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue('COMFYAPP_PORT="3100"', "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue("COMFYAPP_PORT='3100'", "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue("COMFYAPP_PORT = 3100", "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue("  COMFYAPP_PORT=3100", "COMFYAPP_PORT")).toBe("3100");
    expect(
      readEnvFileValue("COMFYAPP_PORT=3100   # 固定端口", "COMFYAPP_PORT"),
    ).toBe("3100");
    // `abc#def` 里的 `#` 是值的一部分，不能当注释切掉。
    expect(readEnvFileValue("COMFYAPP_PORT=abc#def", "COMFYAPP_PORT")).toBe(
      "abc#def",
    );
    // 整行注释（.env.example 的示例行）不算配置；键名子串不算匹配。
    expect(readEnvFileValue("# COMFYAPP_PORT=3100\n", "COMFYAPP_PORT")).toBeNull();
    expect(
      readEnvFileValue("OTHER_COMFYAPP_PORT=3100", "COMFYAPP_PORT"),
    ).toBeNull();
    expect(readEnvFileValue("", "COMFYAPP_PORT")).toBeNull();
  });

  it(".env 非法值视为「未配置」而不是挡死启动（与另三侧同口径）", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-bad-"));
    try {
      for (const bad of ["not-a-number", "", "70000", "0", "-1"]) {
        fs.writeFileSync(
          path.join(tmp, ".env"),
          `COMFYAPP_PORT=${bad}\n`,
          "utf8",
        );
        expect(readEnvPort(tmp), `COMFYAPP_PORT=${bad}`).toBeNull();
        expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(".env 缺失时按路径推导而不是撞默认端口（多检出并行的前提）", () => {
    const missing = path.join(os.tmpdir(), "definitely-not-existing-checkout");
    expect(readEnvPort(missing)).toBeNull();
    expect(resolveAppPort(missing)).toBe(derivePortFromPath(missing));
    expect(FALLBACK_PORT).toBe(3100);
  });
});

/**
 * 四语言端口一致性：共享校验向量（ISSUE #489 缺陷 4）。
 *
 * 背景：`changelog.d` 与规范 §1.1 都承诺「Node / PowerShell / Python / Rust 四侧
 * 对同一路径给出同一端口」，但此前四侧各写各的固定断言（且 Node 侧只锁了一个
 * 路径），没有任何测试会发现某一侧漂移 —— 例如实测发现 Rust 的
 * `normalize_root_for_port` 完全不做路径解析，Node/Python/PowerShell 对**相对
 * 路径**会拼 cwd，于是 `rel/p` 四侧端口不同。对绝对路径（真实检出的形态）
 * 不影响，但「四侧一致」当时只是文档承诺，不是可失败断言。
 *
 * 这里把向量集中到 `tests/fixtures/app-port-vectors.json`，四侧测试读**同一份**
 * 文件：Node（本文件）、PowerShell / Python / Rust 各自断言同一批 input→port。
 * 任一侧实现漂移 → 对应侧测试失败，而不是等到 Windows 真机上才发现。
 */
describe("app-port 四语言共享校验向量", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "app-port-vectors.json"),
      "utf8",
    ),
  ) as {
    vectors: {
      input: string;
      normalized: string;
      fnv1a32: number;
      port: number;
    }[];
  };

  it("向量文件非空（防止误删后测试静默全绿）", () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(5);
  });

  it("每个向量：Node 侧规范化 / 哈希 / 端口三者一致", () => {
    for (const v of fixture.vectors) {
      expect(normalizeRootForPort(v.input)).toBe(v.normalized);
      expect(fnv1a32(v.normalized)).toBe(v.fnv1a32);
      expect(derivePortFromPath(v.input)).toBe(v.port);
    }
  });

  it("同一检出的书写差异（分隔符 / 大小写 / 尾斜杠）归一到同一端口", () => {
    // F:\… 与 F:/… 与 F:/…/ 三条向量必须同端口 —— 这正是 §1.1 的承诺。
    const win = fixture.vectors.filter((v) =>
      v.normalized === "f:/ai/other/comfy-app-t3-branch",
    );
    expect(win.length).toBeGreaterThanOrEqual(3);
    expect(new Set(win.map((v) => v.port)).size).toBe(1);
  });
});

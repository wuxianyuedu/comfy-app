/**
 * 提交门槛自检:把 scripts/check-react-updater-purity.cjs 当黑盒跑在临时
 * fixtures 上,验证「React 函数式 setState updater 里不许放副作用裸调用」
 * 这条硬规则(ISSUE #141)真的会阻断提交,而不是只写在文档里。
 *
 * 背景:ISSUE #141 报出 "Cannot update a component (ExtractModelSelect) while
 * rendering a different component (DarkSelect)" —— DarkSelect 把副作用
 * emitOpenChange(!value) 塞进了 setOpen((value) => {...}) 的函数式 updater。
 * React 的函数式 updater 是纯函数,会在渲染/调度阶段被求值;在其中调用外部
 * 函数触发别的组件 setState,就是渲染期改父组件 state 的告警源。
 *
 * 为什么把 fixtures 放临时目录、脚本用位置参数指向它:本脚本 require("typescript"),
 * 只有从仓库根跑才能解析到 node_modules;而 fixtures 又不能污染仓库 src/,
 * 故测试把坏/好样例写进 tmp,再用 node scripts/check-react-updater-purity.cjs <dir>
 * 调用同一脚本(等价于真实门禁的解析路径)。
 */
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-react-updater-purity.cjs");

let workdir = "";

function run(dir: string): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [SCRIPT, dir],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "updater-purity-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-react-updater-purity.cjs（提交门槛）", () => {
  it("updater 内无副作用裸调用 → 放行", () => {
    // 纯块体 updater:局部派生后 return,未触发外部调用
    writeFileSync(
      join(workdir, "ok.tsx"),
      `"use client";
import { useState } from "react";
export function Ok() {
  const [logs, setLogs] = useState<string[]>([]);
  const cb = () => {
    setLogs((prev) => {
      const capped = [...prev].slice(-10);
      return capped.length ? capped : ["seed"];
    });
    // 副作用(setLogs 之外的调用)在 setState 之外,合规
    console.log("persist outside");
  };
  void cb;
  return null;
}
`,
    );
    const { code, output } = run(workdir);
    expect(output).toContain("[updater-purity] OK");
    expect(code).toBe(0);
  });

  it("updater 内调用副作用函数(ISSUE #141 同形)→ 阻断", () => {
    writeFileSync(
      join(workdir, "bad.tsx"),
      `"use client";
import { useState } from "react";
export function Bad() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const emitOpenChange = (v: boolean) => { if (v) setPending(true); };
  const onToggle = () => {
    setOpen((value) => {
      emitOpenChange(!value); // 副作用在 updater 内 → 阻断
      return !value;
    });
  };
  void onToggle;
  return null;
}
`,
    );
    const { code, output } = run(workdir);
    expect(code).toBe(1);
    expect(output).toContain("setOpen");
    expect(output).toContain("emitOpenChange");
  });

  it("updater 内嵌套 setState → 阻断", () => {
    writeFileSync(
      join(workdir, "nested.tsx"),
      `"use client";
import { useState } from "react";
export function N() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const f = () => {
    setOpen((value) => {
      setPending(value);
      return !value;
    });
  };
  void f;
  return null;
}
`,
    );
    const { code } = run(workdir);
    expect(code).toBe(1);
  });

  it("纯派生的隐式返回箭头 updater → 放行", () => {
    writeFileSync(
      join(workdir, "implicit.tsx"),
      `"use client";
import { useState } from "react";
export function I() {
  const [hits, setHits] = useState(0);
  const inc = () => setHits((n) => n + 1);
  const dec = () => setHits((n) => Math.max(0, n - 1));
  void inc; void dec;
  return null;
}
`,
    );
    const { code } = run(workdir);
    expect(code).toBe(0);
  });
});

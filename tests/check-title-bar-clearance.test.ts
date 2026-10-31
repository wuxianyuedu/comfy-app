/**
 * 标题行让位门禁的自测（ISSUE #310 弹窗类回归）。
 *
 * 为什么要有：这条门禁的价值全在**判定口径**上——漏一个浮层形态，回归就再来一次。
 * 用「临时仓库 + 只放被测文件」跑真脚本，断言「该拦的拦、不该误伤的放过」，
 * 别让门禁自己变成误报源（成员会直接删掉误报的门禁，等于没有）。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { copyGateDeps } from "./helpers/gate-repo";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-title-bar-clearance.cjs");
const tempDirs: Array<string> = [];

/** 造一个只含被测文件的临时仓库（脚本按仓库根解析扫描目录）。 */
function scanner(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "title-bar-"));
  tempDirs.push(root);
  // 脚本按自身位置解析仓库根（__dirname/..），故必须放进临时仓库的 scripts/，
  // 否则扫的还是真实仓库 —— 那样用例会「总是通过」，等于没测。
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  /* 判据 `require("./gate-scan-read.cjs")`（`--staged` 的共享短路器）—— 临时仓库只放得下被测那一份脚本时，缺依赖的表现是可读性极差的 requireStack，所以按 `require("./x.cjs")` 递归补齐（同 `tests/helpers/gate-repo.ts` 的文件头）。 */
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  copyGateDeps(path.join(root, "scripts", path.basename(SCRIPT)));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const run = (): { ok: boolean; output: string } => {
    try {
      return {
        ok: true,
        output: execFileSync(
          process.execPath,
          [path.join(root, "scripts", path.basename(SCRIPT))],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (error) {
      const e = /* SAFETY: 类型断言已复核 */ error as { stderr?: string; stdout?: string; };
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };
  return { run };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-title-bar-clearance", () => {
  it("拦下铺满视口、盖住标题行的弹窗", () => {
    const { run } = scanner({
      "src/components/studio/FooModal.tsx": `export function FooModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div>内容</div>
    </div>
  );
}
`,
    });
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.output).toContain("src/components/studio/FooModal.tsx:3");
  });

  it("放过已用 overlayClass 让位的浮层", () => {
    const { run } = scanner({
      "src/components/studio/FooModal.tsx": `import { overlayClass } from "~/lib/full-screen-layer";

export function FooModal() {
  return (
    <div className={overlayClass("modal", "z-50 flex items-center bg-black/60 p-4")}>
      <div>内容</div>
    </div>
  );
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("放过非顶层的 inset-0（只铺自己的定位祖先）", () => {
    const { run } = scanner({
      "src/components/studio/FooCard.tsx": `export function FooCard() {
  return (
    <div className="relative">
      <div className="absolute inset-0 pointer-events-none" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("放过底层 app shell 的固定元素（底部状态栏等）", () => {
    const { run } = scanner({
      "src/components/studio/FooStatusBar.tsx": `export function FooStatusBar() {
  return <div className="fixed bottom-0 left-0 right-0 z-40 h-8" />;
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("拦下渲染标题行却没给 chrome 档层级的文件", () => {
    const { run } = scanner({
      "src/components/studio/TitleBarTabs.tsx": `import { TITLE_BAR_HEIGHT_CLASS } from "~/lib/full-screen-layer";

export function TitleBarTabs() {
  return <div className={\`flex \${TITLE_BAR_HEIGHT_CLASS} shrink-0 items-stretch\`} />;
}
`,
    });
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.output).toContain("src/components/studio/TitleBarTabs.tsx:4");
    expect(res.output).toContain("TITLE_BAR_CHROME_CLASS");
  });

  it("放过带上 chrome 档层级的标题行（导入行本身不算渲染点）", () => {
    const { run } = scanner({
      "src/components/studio/TitleBarTabs.tsx": `import {
  TITLE_BAR_CHROME_CLASS,
  TITLE_BAR_HEIGHT_CLASS,
} from "~/lib/full-screen-layer";

export function TitleBarTabs() {
  return <div className={\`flex \${TITLE_BAR_HEIGHT_CLASS} \${TITLE_BAR_CHROME_CLASS} shrink-0\`} />;
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("放过另给尺寸/偏移的写法（不是铺满整个视口）", () => {
    const { run } = scanner({
      "src/components/studio/FooPopover.tsx": `export function FooPopover() {
  return <div className="fixed top-2 right-2 z-50 w-56 rounded-lg" />;
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("拦下没交出可用区域的锚定浮层（气泡被标题行盖掉那件事，ISSUE #1377）", () => {
    const { run } = scanner({
      "src/components/ui/tooltip.tsx": `import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

export function TooltipContent() {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner side="top" className="z-popup isolate">
        <TooltipPrimitive.Popup>提示</TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
`,
    });
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.output).toContain("src/components/ui/tooltip.tsx:6");
    expect(res.output).toContain("useOverlayBoundary");
  });

  it("放过交出可用区域的锚定浮层", () => {
    const { run } = scanner({
      "src/components/ui/tooltip.tsx": `import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { useOverlayBoundary } from "~/components/ui/use-overlay-boundary";

export function TooltipContent() {
  const boundary = useOverlayBoundary();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side="top"
        collisionBoundary={boundary ?? undefined}
        className="z-popup isolate"
      >
        <TooltipPrimitive.Popup>提示</TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("拦下按视口高度铺开的整屏页面（错误页盖住关闭按钮那件事，ISSUE #1794）", () => {
    const { run } = scanner({
      "src/app/error.tsx": `export default function Error() {
  return <div className="bg-bg flex min-h-screen flex-col">出错了</div>;
}
`,
    });
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.output).toContain("src/app/error.tsx:2");
    expect(res.output).toContain("FULL_PAGE_CLEARANCE_CLASS");
  });

  it("放过让出标题行的整屏页面（高度收到内容区）", () => {
    const { run } = scanner({
      "src/app/not-found.tsx": `import { FULL_PAGE_CLEARANCE_CLASS } from "~/lib/full-screen-layer";

export default function NotFound() {
  return <div className={\`bg-bg flex flex-col \${FULL_PAGE_CLEARANCE_CLASS}\`} />;
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("不误伤注释里讲旧写法的整屏页面", () => {
    const { run } = scanner({
      "src/app/error.tsx": `// 从前这里写 min-h-screen，会盖住标题行 —— 现已改用内容区高度。
export default function Error() {
  return <div className="h-full min-h-0" />;
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("不误伤组件层的 min-h-screen（第四条规则只扫 src/app）", () => {
    const { run } = scanner({
      "src/components/studio/Foo.tsx": `export function Foo() {
  return <div className="bg-bg flex min-h-screen flex-col" />;
}
`,
    });
    expect(run().ok).toBe(true);
  });

  it("不误伤 Positioner.Props 这类类型引用（只有 JSX 开标签才算浮层）", () => {
    const { run } = scanner({
      "src/components/ui/navigation-menu.tsx": `import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";

type Props = Pick<NavigationMenuPrimitive.Positioner.Props, "align">;

export function NavigationMenuPositioner(props: Props) {
  return (
    <NavigationMenuPrimitive.Positioner
      align={props.align}
      collisionBoundary={boundary ?? undefined}
    />
  );
}
`,
    });
    expect(run().ok).toBe(true);
  });
});

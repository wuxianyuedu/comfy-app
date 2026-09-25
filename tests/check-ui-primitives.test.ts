/**
 * 提交门槛自检：把 scripts/check-ui-primitives.cjs 当黑盒跑在临时工作区上，
 * 验证「视图层自实现 UI 基元」这条棘轮（规范 §16.2.3）真的会阻断提交。
 *
 * 规范：docs/standards/16-shadcn-ui与表单校验.md §16.2.3（ISSUE #672）
 *
 * 为什么用子进程跑：门禁由 pre-commit 以 `node scripts/xxx.cjs` 调用，且内部以
 * `__dirname/..` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-ui-primitives.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-ui-primitives.cjs"), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
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

function write(rel: string, content: string): void {
  const full = join(workdir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "ui-primitives-gate-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  // 先探一次 umask/权限行为：某些沙箱会把新建目录设成不可写（drwxr-xr-x），
  // 那样 `--update` 落盘基线会 EACCES —— 显式补齐，测试不该被环境权限误红。
  chmodSync(join(workdir, "scripts"), 0o777);
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-ui-primitives.cjs"));
  // vitest worker 里创建的临时脚本默认可能带不上可执行位，而门禁是用
  // `node <script>` 跑的 —— 显式补齐权限位，避免在只读/受限 umask 下误红。
  chmodSync(join(workdir, "scripts", "check-ui-primitives.cjs"), 0o755);
  for (const d of [
    "src/components/studio",
    "src/components/workshop",
    "src/components/ui",
    "src/app",
    /* 本批三条判据（P39/P40/P41）的落点横跨 `src/lib` 与 `src/server` ——
     * 见脚本里的 `LIB_SCANNED_RULES`。 */
    "src/lib",
    "src/server/lib",
    /* 本批三条判据（P53/P54/P55）的落点在 `lib/log` 与 `lib/shell`
     * （日志出口 / 浮层刻度表的书写法换算）—— 同上，见 `LIB_SCANNED_RULES`。 */
    "src/lib/log",
    "src/lib/shell",
    "src/components/studio/logs",
  ]) {
    mkdirSync(join(workdir, d), { recursive: true });
  }
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 基线是首次 `--update` 写出的（门禁自身的常规用法）。 */
function seedBaseline(): void {
  const { code, output } = run(["--update"]);
  expect(code, output).toBe(0);
}

const BUTTON_VIEW =
  'export function V() {\n  return <button type="button">ok</button>;\n}\n';
const PORTAL_VIEW =
  'import { createPortal } from "react-dom";\nexport const P = () => createPortal(null, document.body);\n';
const SPIN_VIEW =
  'export function S() {\n  return <span className="animate-spin" />;\n}\n';
const SCROLLBAR_VIEW =
  'export function C() {\n  return <div className="[&::-webkit-scrollbar-thumb]:bg-red-500!" />;\n}\n';
const CLIPBOARD_VIEW =
  'export function K() {\n  const onCopy = () => void navigator.clipboard.writeText("a");\n  return <span onClick={onCopy}>copy</span>;\n}\n';
const DOWNLOAD_VIEW =
  'export function D() {\n  const save = () => URL.createObjectURL(new Blob(["x"]));\n  return <span onClick={save}>save</span>;\n}\n';
const FILE_INPUT_VIEW =
  'export function F() {\n  const ref = useRef<HTMLInputElement>(null);\n  return <input ref={ref} type="file" className="hidden" />;\n}\n';
const DASH_FALLBACK_VIEW =
  'export function E({ v }: { v?: string }) {\n  return <span>{v ?? "—"}</span>;\n}\n';
/* 自绘折叠开关：原生 `<details>`（P10 形态 ①）。 */
const DETAILS_VIEW =
  "export function T() {\n  return (\n    <details>\n      <summary>展开</summary>\n      <pre>x</pre>\n    </details>\n  );\n}\n";
/* 自绘折叠开关：`role="button"` + `▸/▾`（P10 形态 ②）。 */
const ROLE_BUTTON_TOGGLE_VIEW =
  'export function T() {\n  return (\n    <div role="button" tabIndex={0} onClick={onToggle}>\n      <span>{open ? "▾" : "▸"}</span>\n      <span>标题</span>\n    </div>\n  );\n}\n';
/* 只有装饰性的 `▾`、没有 `role="button"`（**不是**折叠，也不手搓浮层）。 */
const CARET_ONLY_VIEW =
  'export function C() {\n  return (\n    <MenuTrigger>\n      <span>{label}</span>\n      <span className={open ? "rotate-180" : ""}>▾</span>\n    </MenuTrigger>\n  );\n}\n';
/* 自绘「可滚动的浮层选项列表」：既建 PopoverTrigger 又画 `▾`（P11）。 */
const CHIP_POPOVER_VIEW =
  'export function C({ value }: { value: string }) {\n  return (\n    <Popover open={open} onOpenChange={setOpen}>\n      <PopoverTrigger>\n        <span>{label}</span>\n        <span>▾</span>\n      </PopoverTrigger>\n      <PopoverContent className="max-h-72 overflow-y-auto">\n        <Button role="option" aria-selected={value === "a"}>A</Button>\n      </PopoverContent>\n    </Popover>\n  );\n}\n';
/* 自写轮询：视图里直接 setInterval（P12）。 */
const SET_INTERVAL_VIEW =
  "export function P() {\n  useEffect(() => {\n    const t = setInterval(() => void poll(), 4000);\n    return () => clearInterval(t);\n  }, []);\n  return null;\n}\n";
/* 自写搜索归一化：视图里自己写 trim + 折小写（P13 形态 ①）。 */
const SEARCH_NEEDLE_VIEW =
  "export function S({ keyword }: { keyword: string }) {\n  const needle = keyword.trim().toLowerCase();\n  return <List rows={rows.filter((r) => matches(r, needle))} />;\n}\n";
/* 自写搜索归一化：只 `trim()` 不折小写 —— **P13 必须也能看见这一种**
 *（`AttributeMultiSelect` 的原始缺陷就是它，而它不含 `.trim().toLowerCase()`）。 */
const SEARCH_TRIM_ONLY_VIEW =
  "export function S({ kw }: { kw: string }) {\n  const needle = kw.trim();\n  return <List rows={rows.filter((r) => r.name.includes(needle))} />;\n}\n";
/* 自己维护一份展开集合（P14）。 */
const EXPANSION_MAP_VIEW =
  "export function T({ parent }: { parent: string }) {\n  const [open, setOpen] = useState<Record<string, boolean>>({});\n  return (\n    <Row\n      open={!!open[parent]}\n      onToggle={() => setOpen((prev) => ({ ...prev, [parent]: !prev[parent] }))}\n    />\n  );\n}\n";
/* 自己维护面板加宽档（P15）。 */
const WIDE_PANEL_VIEW =
  'export function W() {\n  const [wide, setWide] = useState(false);\n  return (\n    <DialogContent popupClassName={wide ? PANEL_WIDTH.wide : PANEL_WIDTH.base}>\n      <Button onClick={() => setWide((w) => !w)}>{wide ? "收缩" : "加宽"}</Button>\n    </DialogContent>\n  );\n}\n';
/* 自绘进度条填充：track + 内层 `width: X%`（P16）。 */
const PROGRESS_FILL_VIEW =
  'export function P({ pct }: { pct: number }) {\n  return (\n    <div className="bg-subtle h-1.5 w-full overflow-hidden rounded-full">\n      <div className="bg-primary h-full" style={{ width: `${pct}%` }} />\n    </div>\n  );\n}\n';
/* 自写键值行：muted 色标签叶子 + `displayValue(...)` 值（P17）。 */
const KEY_VALUE_ROW_VIEW =
  'export function Kv({ row }: { row: { label: string; v: unknown } }) {\n  return (\n    <div className="flex items-center justify-between">\n      <span className="text-ink-muted">{row.label}</span>\n      <span className="text-ink-bright font-mono">{displayValue(row.v)}</span>\n    </div>\n  );\n}\n';
/* 自写键值行：muted 色标签叶子 + `JSON.stringify(...)` 值（P17 形态 ②）。 */
const KEY_VALUE_JSON_VIEW =
  'export function Kv({ row }: { row: { label: string; v: unknown } }) {\n  return (\n    <div>\n      <span className="text-muted-foreground">{row.label}</span>\n      <span>{JSON.stringify(row.v)}</span>\n    </div>\n  );\n}\n';
/* 裸写 <img>：视图直接渲染媒体标签，而不是走 MediaThumbnail（P18）。 */
const RAW_IMG_VIEW =
  'export function A({ src }: { src: string }) {\n  return <img src={src} alt="" className="h-10 w-10 object-cover" />;\n}\n';
/* 裸写 <video> 同样算「自己实现一份媒体渲染」（P18）。 */
const RAW_VIDEO_VIEW =
  'export function V({ src }: { src: string }) {\n  return <video src={src} controls className="h-10 w-10" />;\n}\n';
/* 带自己的 onError 兜底也算自实现 —— 这正是这条账里「更完整」的那一半，
 * 但它仍然是第四份写法（P18）。 */
const RAW_IMG_WITH_ON_ERROR_VIEW =
  'export function A({ src }: { src: string }) {\n  const [failed, setFailed] = useState(false);\n  if (failed) return <p>图片不可用</p>;\n  return <img src={src} alt="" onError={() => setFailed(true)} />;\n}\n';
/* 手写跨组件拖拽源：自定义 MIME 的字面量（P19）。 */
const HAND_WRITTEN_DRAG_VIEW =
  'export function D({ item }: { item: MediaItem }) {\n  return (\n    <div\n      draggable\n      onDragStart={(event) => {\n        event.dataTransfer.setData(\n          "application/x-comfyapp-media",\n          JSON.stringify({ url: item.url, displayName: item.name, mediaType: item.kind }),\n        );\n        event.dataTransfer.effectAllowed = "copy";\n      }}\n    >\n      {item.name}\n    </div>\n  );\n}\n';
/* 组件内拖拽（React Flow 节点 / 表单行）不带这个 MIME —— P19 必须放行。 */
const INNER_DRAG_VIEW =
  "export function D({ onMove }: { onMove: () => void }) {\n  return (\n    <div draggable onDragStart={() => onMove()} onDragEnd={onMove}>\n      handle\n    </div>\n  );\n}\n";
/* 自己往 window 上挂 keydown（P20）。 */
const HAND_WRITTEN_HOTKEY_VIEW =
  'export function H({ onOpen }: { onOpen: () => void }) {\n  useEffect(() => {\n    const handler = (e: KeyboardEvent) => {\n      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {\n        e.preventDefault();\n        onOpen();\n      }\n    };\n    window.addEventListener("keydown", handler);\n    return () => window.removeEventListener("keydown", handler);\n  }, [onOpen]);\n  return null;\n}\n';

/* 自绘模态浮层：**不含任何 `createPortal`** —— 这正是 P2 数不到的那一侧
 *（P2 问「有没有用某 API」，P9 问「有没有自己拼一份浮层外壳」）。 */
const MODAL_OVERLAY_VIEW =
  'export function M({ onClose }: { onClose: () => void }) {\n  return (\n    <div\n      className={overlayClass("modal", `${zClass("modal")} bg-black/60`)\n      onClick={onClose}\n    >\n      <div className="rounded-2xl bg-panel" onClick={(e) => e.stopPropagation()} />\n    </div>\n  );\n}\n';

describe("check-ui-primitives.cjs（提交门槛，规范 §16.2.3）", () => {
  it("视图里手写 <button> 会被阻断（规范 P1）", () => {
    write("src/components/workshop/A.tsx", BUTTON_VIEW);
    run(["--update"]);
    write("src/components/workshop/A2.tsx", BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P1");
    expect(output).toContain("src/components/workshop/A2.tsx");
  });

  it("视图里自建 createPortal 浮层会被阻断（规范 P2）", () => {
    write("src/components/studio/B.tsx", PORTAL_VIEW);
    run(["--update"]);
    write("src/components/studio/B2.tsx", PORTAL_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P2");
  });

  it("视图里自写 animate-spin / animate-pulse 会被阻断（规范 P3）", () => {
    write("src/components/studio/C.tsx", SPIN_VIEW);
    run(["--update"]);
    write("src/components/studio/C2.tsx", SPIN_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P3");
  });

  /* ── P7 / P8：同 P4~P6 的硬闸，口径是「必须为 0」─────────────────────
   * 这两条与 P1~P3 的棘轮**性质不同**：棘轮允许「先冻结存量再逐批降」，
   * 而 P7/P8 已经在同批清零，所以基线里没有它们 —— 第一处新增就直接断。 */
  it("视图里自写「隐藏 file input + 手工触发」直接阻断（规范 P7）", () => {
    seedBaseline();
    write("src/components/workshop/F.tsx", FILE_INPUT_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P7");
    expect(output).toContain("src/components/workshop/F.tsx");
  });

  it("可见的 <input type=file> 不计入 P7（是另一种形态）", () => {
    /* FilmStudio 的 BGM 选择器是**用户可见的表单字段**（靠 `file:` 伪元素
     * 美化、就地显示已选文件名）—— 它不欠 file-picker 的契约。判据若把它
     * 也算上，唯一的修法是把可见输入框硬改成隐藏 input + 按钮，那是**改坏
     * 外观**去迎合判据。 */
    seedBaseline();
    write(
      "src/components/workshop/G.tsx",
      'export const G = () => <input type="file" className="file:bg-violet-500/20" />;\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写「值不存在显示 —」直接阻断（规范 P8）", () => {
    seedBaseline();
    write("src/components/workshop/H.tsx", DASH_FALLBACK_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P8");
  });

  it("用了 displayValue 的地方不含占位符字面量，自然不被 P8 计", () => {
    seedBaseline();
    write(
      "src/components/workshop/I.tsx",
      'import { displayValue } from "~/lib/display-value";\nexport const I = ({ v }: { v?: string }) => <span>{displayValue(v)}</span>;\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P7/P8 未清零时 --update 拒绝更新基线", () => {
    write("src/components/studio/J.tsx", FILE_INPUT_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("硬闸");
  });

  it("视图里自绘模态浮层直接阻断（规范 P9）", () => {
    /* P9 是「按形态」的判据：P2 只数 `createPortal(`，而这批落点**一处 portal
       都没有**（把遮罩写成一个普通 div）—— 所以它们在 P2 全库清零后依然漏过。
       锚点取 `overlayClass(`：本项目顶层浮层定位的唯一出口，视图里出现它 =
       这个文件在自绘浮层容器。 */
    seedBaseline();
    write("src/components/workshop/Modal.tsx", MODAL_OVERLAY_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P9");
    expect(output).toContain("src/components/workshop/Modal.tsx");
  });

  it("`overlayClass` 只出现在基元里时不被计（判据够不着工具生成的浮层容器）", () => {
    /* `ui/fullscreen-dialog` 自己也调 `overlayClass`，但它在 `ui/` 豁免目录里；
       视图调用处走的是**基元组件**（`<FullScreenLayer>` / `<Dialog>`），
       不出现这次调用 —— 否则每个用基元的文件都会被误判成「自绘」。 */
    seedBaseline();
    write(
      "src/components/workshop/UsesPrimitive.tsx",
      'import { FullScreenLayer } from "~/components/studio/fullscreen/FullScreenLayer";\nexport const U = () => <FullScreenLayer zClass="z-modal">x</FullScreenLayer>;\n',
    );
    write("src/components/ui/local-overlay.tsx", MODAL_OVERLAY_VIEW);
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("注释里提到 overlayClass 不算实现（与 P1 同一份剥离）", () => {
    seedBaseline();
    write(
      "src/components/workshop/Documented.tsx",
      '/* 这里此前是 `overlayClass("modal", …)` 自绘的浮层，已改走 ui/dialog。 */\nexport const Doc = () => null;\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P9 未清零时 --update 拒绝更新基线", () => {
    write("src/components/studio/ModalUpdate.tsx", MODAL_OVERLAY_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("硬闸");
  });

  it("P9 的计数不进棘轮基线", () => {
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { rules: Record<string, string> };
    expect(baseline.rules.P9).toBeUndefined();
  });

  it("P7/P8 的计数不进棘轮基线", () => {
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { rules: Record<string, string> };
    expect(baseline.rules.P7).toBeUndefined();
    expect(baseline.rules.P8).toBeUndefined();
  });

  it("视图里自写 ::-webkit-scrollbar 外观直接阻断，不进棘轮（规范 P4）", () => {
    /* P4 与 P1~P3 不同：它不是「先冻结存量」的棘轮，而是**硬闸** ——
       自绘滚动条外观的唯一出口是 globals.css（`.custom-scrollbar` /
       `.soft-scrollbar`）。所以基线里没有这一条，第一处新增就直接断。 */
    seedBaseline();
    write("src/components/workshop/E.tsx", SCROLLBAR_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P4");
    expect(output).toContain("src/components/workshop/E.tsx");
  });

  it("P4 未清零时 --update 拒绝更新基线（硬闸不能靠放水绕过）", () => {
    seedBaseline();
    write("src/components/studio/F.tsx", SCROLLBAR_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("硬闸");
  });

  it("视图里自写剪贴板写入直接阻断，不进棘轮（规范 P5）", () => {
    /* 与 P4 同性质：`~/lib/browser-io` 的 copyText 是唯一出口（含降级链路），
       所以第一处自写就断，不存在「先冻结存量」的中间态。 */
    seedBaseline();
    write("src/components/studio/G.tsx", CLIPBOARD_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P5");
    expect(output).toContain("src/components/studio/G.tsx");
  });

  it("视图里自写 Blob 下载直接阻断，不进棘轮（规范 P6）", () => {
    seedBaseline();
    write("src/components/studio/H.tsx", DOWNLOAD_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P6");
  });

  it("P5/P6 未清零时 --update 拒绝更新基线", () => {
    seedBaseline();
    write("src/components/studio/I.tsx", CLIPBOARD_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("硬闸");
  });

  it("P5/P6 的计数不进棘轮基线", () => {
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { rules: Record<string, string> };
    expect(baseline.rules.P5).toBeUndefined();
    expect(baseline.rules.P6).toBeUndefined();
  });

  it("P4 的计数不进棘轮基线（P4 只在 HARD_GATE_RULES 里判空）", () => {
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { rules: Record<string, string> };
    expect(baseline.rules.P4).toBeUndefined();
  });

  /* ── P10 / P11 / P12：本批三条硬闸（规范 16 §16.2.4.13 ~ §16.2.4.15）──
   *
   * 三条都按**形态**取锚点，不按 API —— 这正是前几批反复踩到的坑：
   * P2 数 `createPortal` 漏掉 16 个自绘模态；P10 若数「用了哪个组件」会漏掉
   * 「用另一种方式做同一件事」。所以这里逐个钉住「正面命中 + 反面不误伤」。 */
  it("视图里原生 <details> 折叠块直接阻断（规范 P10）", () => {
    seedBaseline();
    write("src/components/workshop/Accordion.tsx", DETAILS_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P10");
    expect(output).toContain("src/components/workshop/Accordion.tsx");
  });

  it("视图里自绘 role=button + ▸/▾ 折叠开关直接阻断（规范 P10）", () => {
    seedBaseline();
    write("src/components/studio/Toggle.tsx", ROLE_BUTTON_TOGGLE_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P10");
  });

  it("只有装饰性 ▾、没有 role=button / PopoverTrigger 时两条都不误伤", () => {
    /* 这是两条判据的**边界**：`▾` 在 chip / 下拉 / 弹窗触发器上都会出现，
     * 单看它会把「打开面板」误判成「折起来」（P10）或「手搓浮层」（P11）。
     * 所以 P10 要求 `role="button"` 与标记**同时**出现，P11 要求
     * `PopoverTrigger` 与标记**同时**出现。 */
    seedBaseline();
    write("src/components/studio/Caret.tsx", CARET_ONLY_VIEW);
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("注释里提到 <details> 不算实现（与 P1 同一份剥离）", () => {
    seedBaseline();
    write(
      "src/components/workshop/DocumentedToggle.tsx",
      "/* 这里此前是原生 `<details>` + `<summary>`，已改走 ui/disclosure。 */\nexport const D = () => null;\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里手搓 chip 浮层（PopoverTrigger + ▾）直接阻断（规范 P11）", () => {
    seedBaseline();
    write("src/components/workshop/MyChip.tsx", CHIP_POPOVER_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P11");
    expect(output).toContain("src/components/workshop/MyChip.tsx");
  });

  it("只用 PopoverTrigger 而自己画 ▾ 之外的东西：不被 P11 误伤", () => {
    seedBaseline();
    write(
      "src/components/studio/PlainPopover.tsx",
      "export function P() {\n  return (\n    <Popover>\n      <PopoverTrigger>打开</PopoverTrigger>\n      <PopoverContent>x</PopoverContent>\n    </Popover>\n  );\n}\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写 setInterval 轮询直接阻断（规范 P12）", () => {
    seedBaseline();
    write("src/components/studio/Poller.tsx", SET_INTERVAL_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P12");
    expect(output).toContain("src/components/studio/Poller.tsx");
  });

  it("服务端路由里的 setInterval 不算「视图轮询」（P12 豁免 app/api/**）", () => {
    seedBaseline();
    write(
      "src/app/api/tasks/[id]/stream/route.ts",
      "export async function GET() {\n  const hb = setInterval(() => {}, 15000);\n  return new Response(String(hb));\n}\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P13 / P14 / P15：本批三条硬闸（规范 16 §16.2.4.16 ~ §16.2.4.18）──
   *
   * 与 P10~P12 同款：判据按**形态**取锚点，且**两条边界都要有用例** ——
   * 判据太宽会逼下一个人改坏代码去迎合它。这三条各有一条特别的边界：
   *   · P13 必须同时看见「只 trim 不折小写」那种写法（更差的那种）；
   *   · P14 不能把「在跑标记」这类非折叠语义的 Record 算进来；
   *   · P15 不能把普通的 `useState(false)` 弹窗开关算进来。 */
  it("视图里自写搜索归一化（trim + 折小写）直接阻断（规范 P13）", () => {
    seedBaseline();
    write("src/components/studio/Searchable.tsx", SEARCH_NEEDLE_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P13");
    expect(output).toContain("src/components/studio/Searchable.tsx");
  });

  it("只 trim 不折小写也算（更差的那种写法不能漏，规范 P13）", () => {
    /* 这是本批最值得记的一条：`AttributeMultiSelect` 收口前只写了 `trim()`，
     * 候选值含拉丁字母时大小写敏感。它**不含** `.trim().toLowerCase()` ——
     * 判据若只数那一种，被拦下的永远只是合规者。 */
    seedBaseline();
    write("src/components/studio/TrimOnly.tsx", SEARCH_TRIM_ONLY_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P13");
  });

  it("无关的去空白（不是搜索词）不被 P13 误伤", () => {
    seedBaseline();
    write(
      "src/components/studio/Cleanup.tsx",
      "export const clean = (line: string) => line.trim();\nexport const key = (s: string) => s.trim();\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("服务端路由的参数归一化不算「视图搜索框」（P13 豁免 app/api/**）", () => {
    seedBaseline();
    write(
      "src/app/api/things/route.ts",
      'export async function GET(req: Request) {\n  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase();\n  return Response.json({ q });\n}\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写展开集合的翻转样板直接阻断（规范 P14）", () => {
    seedBaseline();
    write("src/components/studio/Tree.tsx", EXPANSION_MAP_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P14");
    expect(output).toContain("src/components/studio/Tree.tsx");
  });

  it("「在跑标记」这类非折叠语义的 Record 不被 P14 误伤", () => {
    /* 边界：`{ ...state, [id]: true }` 是**落位 / 在跑**标记，不是折叠 ——
     * 它没有「翻转」，也不该走 `ExpansionSet`（那会给出一个错误的语义）。 */
    seedBaseline();
    write(
      "src/components/studio/Pending.tsx",
      "export function P({ id }: { id: string }) {\n  const [busy, setBusy] = useState<Record<string, boolean>>({});\n  return <Row onClick={() => setBusy((state) => ({ ...state, [id]: true }))} />;\n}\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写面板加宽档直接阻断（规范 P15）", () => {
    seedBaseline();
    write("src/components/studio/WideThing.tsx", WIDE_PANEL_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P15");
    expect(output).toContain("src/components/studio/WideThing.tsx");
  });

  it("普通的 useState(false) 弹窗开关不被 P15 误伤", () => {
    seedBaseline();
    write(
      "src/components/studio/Modalish.tsx",
      "export function M() {\n  const [open, setOpen] = useState(false);\n  return <Button onClick={() => setOpen((v) => !v)}>打开</Button>;\n}\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P16 / P17：本批两条硬闸（规范 16 §16.2.4.19 ~ §16.2.4.20）────────
   *
   * 这一批的两个问法是「谁在给一段异步动作配进度」与「谁在把一个对象渲染成
   * 键值行」。两条判据各有一条**必须有的反面用例**（判据太宽会逼下一个人
   * 改坏代码去迎合它）：
   *   · P16 不能把普通的 `style={{ width: "200px" }}`（定宽）算进来；
   *   · P17 不能把「只有小标题、没有值」「只有值、没有标签」算进来。 */
  it("视图里自绘进度条填充直接阻断（规范 P16）", () => {
    seedBaseline();
    write("src/components/studio/Progress.tsx", PROGRESS_FILL_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P16");
    expect(output).toContain("src/components/studio/Progress.tsx");
  });

  it("定宽（px）不算进度条，P16 不误伤", () => {
    /* 边界：`width: "280px"` 是布局，`width: \`${pct}%\`` 才是进度。 */
    seedBaseline();
    write(
      "src/components/studio/Fixed.tsx",
      'export const F = () => <div style={{ width: "280px" }} className="bg-primary" />;\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("使用 ProgressBar 的文件不再被 P16 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/Ok.tsx",
      'import { ProgressBar } from "~/components/ui/progress-bar";\nexport const O = ({ pct }: { pct: number }) => <ProgressBar value={pct} />;\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写键值行直接阻断（规范 P17，形态 ①）", () => {
    seedBaseline();
    write("src/components/studio/Kv.tsx", KEY_VALUE_ROW_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P17");
    expect(output).toContain("src/components/studio/Kv.tsx");
  });

  it("值的渲染器是 JSON.stringify 时同样被 P17 计（形态 ②）", () => {
    seedBaseline();
    write("src/components/studio/KvJson.tsx", KEY_VALUE_JSON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P17");
  });

  it("只有小标题、没有值的行不被 P17 误伤", () => {
    seedBaseline();
    write(
      "src/components/studio/Titled.tsx",
      'export const T = () => (\n  <div>\n    <span className="text-ink-muted">参数</span>\n    <List rows={rows} />\n  </div>\n);\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("已经是 KeyValueRows 消费点的文件不被 P17 计（items 里的标签/值不误伤）", () => {
    /* `WorkshopEncapsulationPanel` 的键节点里有个 muted 色的口 id span，
     * 它被作为 `items` 传给 `KeyValueRows` —— 形态判据会把两者连起来误报。
     * 合规者一个都不能误伤，与 P13「更差的那种也要数」是同一枚硬币的两面。 */
    seedBaseline();
    write(
      "src/components/studio/OkKv.tsx",
      'import { KeyValueRows } from "~/components/ui/key-value-rows";\nexport const O = () => (\n  <KeyValueRows\n    items={[\n      { key: <span className="text-muted-foreground">id</span>, value: displayValue(x) },\n    ]}\n  />\n);\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P18 / P19 / P20：本批三条硬闸（规范 §16.2.4.21 ~ §16.2.4.23）────
   *
   * 这三条的形态锚点都**不取 API 名**（P18 取标签、P19 取自定义 MIME 字面量、
   * P20 取 `addEventListener("keydown"`）—— 前几批的反复教训是「按 API 看
   * 不见那些用另一种方式做同一件事的写法」。每一条都配一个反面用例。 */
  it("视图里裸写 <img> 直接阻断（规范 P18）", () => {
    seedBaseline();
    write("src/components/studio/Raw.tsx", RAW_IMG_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P18");
    expect(output).toContain("src/components/studio/Raw.tsx");
  });

  it("裸写 <video> 同样被 P18 计（出口管的就是图片 / 视频二选一）", () => {
    seedBaseline();
    write("src/components/studio/RawVideo.tsx", RAW_VIDEO_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P18");
  });

  it("带自己的 onError 兜底也算自实现（P18 要数到那 4 份写法）", () => {
    /* 判据必须覆盖「已经写了 onError 但自己实现一份」的那一半 ——
     * 只数「没有 onError」的会漏掉这条账里更完整的四分之一。 */
    seedBaseline();
    write("src/components/studio/RawFallback.tsx", RAW_IMG_WITH_ON_ERROR_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P18");
  });

  it("使用 MediaThumbnail 的文件不再被 P18 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkMedia.tsx",
      'import { MediaThumbnail } from "~/components/ui/media-thumbnail";\nexport const O = ({ src }: { src: string }) => <MediaThumbnail src={src} />;\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里手写媒体拖拽源直接阻断（规范 P19）", () => {
    seedBaseline();
    write("src/components/studio/Drag.tsx", HAND_WRITTEN_DRAG_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P19");
    expect(output).toContain("src/components/studio/Drag.tsx");
  });

  it("组件内拖拽（不带自定义 MIME）不被 P19 误伤", () => {
    /* React Flow 节点与表单行排序都是组件内拖拽 —— 它们不该走「跨组件」
     * 那个出口（出口的载荷形状是给落点解析用的）。 */
    seedBaseline();
    write("src/components/studio/InnerDrag.tsx", INNER_DRAG_VIEW);
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("使用 mediaDragSourceProps 的文件不再被 P19 计", () => {
    seedBaseline();
    write(
      "src/components/studio/OkDrag.tsx",
      'import { mediaDragSourceProps } from "~/components/ui/media-drag-source";\nexport const O = ({ url }: { url: string }) => (\n  <div {...mediaDragSourceProps({ url, kind: "image" })} />\n);\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自己挂 keydown 直接阻断（规范 P20）", () => {
    seedBaseline();
    write("src/components/studio/Hotkey.tsx", HAND_WRITTEN_HOTKEY_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P20");
    expect(output).toContain("src/components/studio/Hotkey.tsx");
  });

  it("只判 ctrlKey（macOS 上按 ⌘ 没反应）这一种更差的写法也数得到", () => {
    /* 与 P13「更差的那种也要数」同源：判据漏掉更差的写法时，被拦下的
     * 永远只是合规者。这里断言的是**形态锚点**（挂 keydown）而不是
     * `metaKey` 有没有 —— 后者正是漏掉那两处的原因。 */
    seedBaseline();
    write(
      "src/components/studio/HotkeyCtrlOnly.tsx",
      'export function H({ onOpen }: { onOpen: () => void }) {\n  useEffect(() => {\n    const h = (e: KeyboardEvent) => {\n      if (e.ctrlKey && e.key === "k") onOpen();\n    };\n    document.addEventListener("keydown", h);\n    return () => document.removeEventListener("keydown", h);\n  }, [onOpen]);\n  return null;\n}\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P20");
  });

  it("使用 useHotkey 的文件不再被 P20 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkHotkey.tsx",
      'import { useHotkey } from "~/components/ui/use-hotkey";\nexport function H({ onOpen }: { onOpen: () => void }) {\n  useHotkey({ key: "l", mod: true, shift: true }, onOpen);\n  return null;\n}\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P21 / P22 / P23：本批三条硬闸（规范 §16.2.4.24 ~ §16.2.4.26）────
   *
   * 三条同样按**形态**取锚点（赋值 `scrollTop = …scrollHeight` /
   * `window.location.href =` / 裸 `<label className="…block…">` + 输入控件），
   * 每条都配反面用例 —— 判据太宽会逼下一个人改坏外观去迎合它。 */
  it("视图里自写滚动贴底直接阻断（规范 P21）", () => {
    seedBaseline();
    write(
      "src/components/studio/Follow.tsx",
      'export function F({ text }: { text: string }) {\n  const ref = useRef<HTMLDivElement>(null);\n  useEffect(() => {\n    const el = ref.current;\n    if (el) el.scrollTop = el.scrollHeight;\n  }, [text]);\n  return <div ref={ref} className="overflow-y-auto" />;\n}\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P21");
    expect(output).toContain("src/components/studio/Follow.tsx");
  });

  it("只读 scrollHeight 做量测（虚拟化的贴底算术）不被 P21 计", () => {
    /* `log-virtual` 的 `pinScrollTop` 只**读**几何、不改 DOM；
     * textarea 自动增高写的是 `style.height`。两者都不是「贴底」这个动作。 */
    seedBaseline();
    write(
      "src/components/studio/Measure.tsx",
      "export function M({ el }: { el: HTMLElement }) {\n  const h = el.scrollHeight - el.clientHeight;\n  const ta = el as unknown as HTMLTextAreaElement;\n  ta.style.height = `${ta.scrollHeight}px`;\n  return <div>{h}</div>;\n}\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("使用 useScrollFollow 的文件不再被 P21 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkFollow.tsx",
      'import { useScrollFollow } from "~/components/ui/use-scroll-follow";\nexport function F({ text }: { text: string }) {\n  const follow = useScrollFollow({ watch: text });\n  return <div ref={follow.containerRef} onScroll={follow.onScroll} />;\n}\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写外部目标导航直接阻断（规范 P22）", () => {
    seedBaseline();
    write(
      "src/components/studio/OpenFolder.tsx",
      "export function O({ url }: { url: string }) {\n  return <div onClick={() => { window.location.href = url; }}>打开</div>;\n}\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P22");
    expect(output).toContain("src/components/studio/OpenFolder.tsx");
  });

  it("对内的路由跳转不被 P22 计（那是 router.push，不是交给外部程序）", () => {
    seedBaseline();
    write(
      "src/components/studio/GoPage.tsx",
      'import { useRouter } from "next/navigation";\nexport function G() {\n  const router = useRouter();\n  return <div onClick={() => router.push("/studio")}>去工作室</div>;\n}\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写「标签 + 控件」的表单行直接阻断（规范 P23）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawField.tsx",
      'export function F({ v, on }: { v: string; on: (s: string) => void }) {\n  return (\n    <label className="block">\n      <span className="text-ink-faint mb-1.5 block text-[11px]">名称</span>\n      <input value={v} onChange={(e) => on(e.target.value)} />\n    </label>\n  );\n}\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P23");
    expect(output).toContain("src/components/studio/RawField.tsx");
  });

  it("整块可点的开关行（label 包住 Switch）不被 P23 计", () => {
    /* 那是另一种形态 —— 标签与控件**并排**、点哪都切换；
     * `FormField` 的块级标签行套上去会改掉那条排布（§16.2.4.2 第 9 条）。 */
    seedBaseline();
    write(
      "src/components/studio/SwitchRow.tsx",
      'export function S({ v, on }: { v: boolean; on: (b: boolean) => void }) {\n  return (\n    <label className="flex cursor-pointer items-center justify-between gap-2">\n      <span className="text-ink-soft">显示网格</span>\n      <Switch checked={v} onCheckedChange={on} />\n    </label>\n  );\n}\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("使用 FormField 的文件不再被 P23 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkField.tsx",
      /* ⚠️ 取值走 `textHandler`：本用例验的是**P23 不误伤**，
       * 而 `(e) => on(e.target.value)` 那个写法本身是 P62 的账 ——
       * 两件事混在一个 fixture 里会让「验 P23」意外地也被 P62 判红
       *（与 P30/P37 的 busyId fixture 互相串是同款问题）。 */
      'import { FormField } from "~/components/ui/form-field";\nimport { textHandler } from "~/lib/form-props";\nexport function F({ v, on }: { v: string; on: (s: string) => void }) {\n  return (\n    <FormField label="名称" id="n">\n      {(a11y) => <input {...a11y} value={v} onChange={textHandler(on)} />}\n    </FormField>\n  );\n}\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P24 / P25 / P26：本批三条硬闸（规范 §16.2.4.27 ~ §16.2.4.29）────
   *
   * 三条同样按**形态**取锚点（`readAs*` / `.text()` 调用、
   * `localStorage.*Item` 调用、`onKeyDown` 里判 `"Enter"`），
   * 每条都配反面用例 —— 判据太宽会逼下一个人改坏代码去迎合它。 */
  it("视图里自写读文件直接阻断（规范 P24）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawRead.tsx",
      [
        "export function R({ file }: { file: File }) {",
        '  const [text, setText] = useState("");',
        "  useEffect(() => {",
        "    void file.text().then(setText);",
        "  }, [file]);",
        "  return <pre>{text}</pre>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P24");
    expect(output).toContain("src/components/studio/RawRead.tsx");
  });

  it("手搓 FileReader 的 readAs* 也被 P24 计（两种写法都要数）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawReader.tsx",
      [
        "export function R({ file }: { file: File }) {",
        '  const [url, setUrl] = useState("");',
        "  useEffect(() => {",
        "    const reader = new FileReader();",
        "    reader.onload = () => setUrl(String(reader.result));",
        "    reader.readAsDataURL(file);",
        "  }, [file]);",
        "  return <div>{url}</div>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P24");
  });

  it("读 fetch 响应体（res.text()）不被 P24 计 —— 那是网络读取", () => {
    seedBaseline();
    write(
      "src/components/studio/FetchText.tsx",
      [
        "export async function F(url: string) {",
        "  const res = await fetch(url);",
        "  const body = await res.text();",
        "  return body;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("使用 readFileAsText 的文件不再被 P24 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkRead.tsx",
      [
        'import { readFileAsText } from "~/lib/file-io";',
        "export async function R(file: File) {",
        "  return readFileAsText(file);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("自写 localStorage 存取直接阻断（规范 P25）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawStorage.tsx",
      [
        "export function S() {",
        '  const [v, setV] = useState("");',
        "  useEffect(() => {",
        '    setV(window.localStorage.getItem("k") ?? "");',
        "  }, []);",
        "  return <span>{v}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P25");
    expect(output).toContain("src/components/studio/RawStorage.tsx");
  });

  it("「压根没判有没有浏览器」的写法也被 P25 计（更差的那一半）", () => {
    /* 单看 `typeof window === "undefined"` 会漏掉这一族 ——
     * 而它们才是这条账里更差的那一种（隐私模式下直接抛）。 */
    seedBaseline();
    write(
      "src/components/studio/RawStorage2.tsx",
      [
        "export function S() {",
        "  try {",
        '    localStorage.setItem("k", "1");',
        "  } catch {",
        "    /* 忽略 */",
        "  }",
        "  return null;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P25");
  });

  it("使用 readStorageItem 的文件不再被 P25 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkStorage.tsx",
      [
        'import { readStorageItem } from "~/lib/browser-storage";',
        "export function S() {",
        '  return <span>{readStorageItem("k")}</span>;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("视图里自写「Enter 提交」键位判据直接阻断（规范 P26）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawEnter.tsx",
      [
        "export function E({ onCommit }: { onCommit: () => void }) {",
        "  return (",
        "    <input",
        "      onKeyDown={(event) => {",
        '        if (event.key === "Enter") onCommit();',
        "      }}",
        "    />",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P26");
    expect(output).toContain("src/components/studio/RawEnter.tsx");
  });

  it("全局快捷键（走 useHotkey）不被 P26 计 —— 那是 P20 的账", () => {
    seedBaseline();
    write(
      "src/components/studio/GlobalKey.tsx",
      [
        'import { useHotkey } from "~/components/ui/use-hotkey";',
        "export function G({ onOpen }: { onOpen: () => void }) {",
        '  useHotkey({ key: "Enter", mod: true }, onOpen);',
        "  return null;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("role=tab 上自己写键判别被 P53 拦下（那是 simpleKeyHandler 的账）", () => {
    seedBaseline();
    write(
      "src/components/studio/TabRow.tsx",
      [
        "export function T({ onSelect }: { onSelect: () => void }) {",
        "  return (",
        '    <div role="tab"',
        "      onKeyDown={(event) => {",
        '        if (event.key === "Enter" || event.key === " ") {',
        "          event.preventDefault();",
        "          onSelect();",
        "        }",
        "      }}",
        "    />",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P53");
  });

  it("使用 enterCommit 的文件不再被 P26 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkEnter.tsx",
      [
        'import { enterCommit } from "~/components/ui/use-enter-commit";',
        "export function E({ onCommit }: { onCommit: () => void }) {",
        "  return <input {...enterCommit({ onCommit })} />;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P27 / P28 / P29：本批三条硬闸（规范 §16.2.4.30 ~ §16.2.4.32）────
   *
   * 三条同样按**形态**取锚点（`try/catch` + 反馈通道、`naturalWidth` 这类
   * 属性名、`?key=${`/`&key=${`），每条都配反面用例 —— 判据太宽会逼下
   * 一个人改坏代码去迎合它（本仓库的既有教训）。 */
  it("自写「try/catch + 反馈通道」样板直接阻断（规范 P27）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawAsync.tsx",
      [
        'import { Button } from "~/components/ui/button";',
        "export function U() {",
        "  const { toast } = useToast();",
        "  const save = async () => {",
        "    try {",
        "      await api.save.mutate({});",
        "    } catch (e) {",
        '      toast.error(errorMessage(e, "保存失败"));',
        "    }",
        "  };",
        "  return <Button onClick={save}>保存</Button>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P27");
    expect(output).toContain("src/components/studio/RawAsync.tsx");
  });

  it("走 runAsyncAction 的动作不再被 P27 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkAsync.tsx",
      [
        'import { runAsyncAction } from "~/lib/async-action";',
        'import { Button } from "~/components/ui/button";',
        "export function U({ toast }: { toast: { error: (s: string) => void } }) {",
        "  const save = () =>",
        "    runAsyncAction(() => api.save.mutate({}), {",
        '      report: (kind, detail) => (kind === "err" ? toast.error(detail) : undefined),',
        '      failureText: "保存失败",',
        "    });",
        "  return <Button onClick={save}>保存</Button>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("没有反馈通道的 catch（静默降级）不被 P27 计", () => {
    /* 只判「有 await 的 try/catch」会把「读缓存失败静默回落」那一族算上 ——
     * 它们是合法的降级，根本没有反馈通道可谈。 */
    seedBaseline();
    write(
      "src/components/studio/SilentFallback.tsx",
      [
        "export async function R() {",
        "  try {",
        "    await readCache();",
        "  } catch (e) {",
        "    console.warn(e);",
        "  }",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("逻辑层（hooks/）里的同一套样板同样被 P27 计（这条账的大头在 hooks）", () => {
    /* P1/P2/P3 豁免 `hooks/`（它们数的是视图实现），但 P27 的存量恰恰
     * 大部分在逻辑层 —— 不扫 hooks 等于对这条账视而不见。 */
    seedBaseline();
    write(
      "src/components/studio/hooks/use-raw-async.ts",
      [
        "export function useRawAsync(toast, errorMessage) {",
        "  return async () => {",
        "    try {",
        "      await api.save.mutate({});",
        "    } catch (e) {",
        '      toast.error(errorMessage(e, "保存失败"));',
        "    }",
        "  };",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P27");
  });

  it("视图里自己读媒体自然尺寸直接阻断（规范 P28）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawSize.tsx",
      [
        "export function P({ el }: { el: HTMLImageElement }) {",
        "  const s = { w: el.naturalWidth, h: el.naturalHeight };",
        "  return <span>{s.w}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P28");
  });

  it("视频的 videoWidth / videoHeight 也计 P28（两组读数同一条账）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawVideoSize.tsx",
      [
        "export function P({ el }: { el: HTMLVideoElement }) {",
        "  return <span>{el.videoWidth + el.videoHeight}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P28");
  });

  it("使用 readNaturalSize 的文件不再被 P28 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkSize.tsx",
      [
        'import { readNaturalSize } from "~/lib/media/natural-size";',
        "export function P({ el }: { el: HTMLImageElement }) {",
        "  const s = readNaturalSize(el);",
        "  return <span>{s?.width ?? 0}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("手拼查询串直接阻断（规范 P29）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawUrl.tsx",
      [
        "export function U(name: string) {",
        "  return fetch(`/api/images?filename=${name}&type=input`);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P29");
  });

  it("模板串开头的第一个参数（`?id=${x}`）也被 P29 计", () => {
    /* 前置字符是反引号 / 引号时，`?` 前面**不是**词字符 —— 判据若要求
     * 「前面必须是词字符」，「第一个参数」那条写法能整片溜过。 */
    seedBaseline();
    write(
      "src/components/studio/RawFirstParam.tsx",
      [
        "export function U(id: string) {",
        "  const qs = `?id=${id}`;",
        "  return fetch(`/api/x${qs}`);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P29");
  });

  it("走 withQuery / buildQueryString 的文件不再被 P29 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/OkUrl.tsx",
      [
        'import { withQuery } from "~/lib/query-string";',
        "export function U(name: string) {",
        "  return fetch(withQuery(`/api/images`, { filename: name, type: `input` }));",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("写死的 href 字面量与正则字面量不被 P29 计（不是「把一组值写成查询串」）", () => {
    /* 只数 `?<键名>=` 会把这两族一起算上 —— 判据要求**真有值被内联**
     *（`${` 或引号），这两处都不是。 */
    seedBaseline();
    write(
      "src/components/studio/StaticHref.tsx",
      [
        "export function L() {",
        "  return (",
        '    <a href="/workspace?tab=canvas">去创作</a>',
        "  );",
        "}",
        "export const RE = /\\|?msg=([^|]*)/;",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("边 id 的 `${a}?${b}` 拼接不被 P29 计（同形而不同源）", () => {
    seedBaseline();
    write(
      "src/components/studio/EdgeId.tsx",
      [
        "export function edgeId(ns: string, entryId: string, handleId: string) {",
        "  return `${ns}:${entryId}?${handleId}`;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P10~P23 未清零时 --update 拒绝更新基线", () => {
    write("src/components/studio/ToggleUpdate.tsx", ROLE_BUTTON_TOGGLE_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("硬闸");
  });

  it("P10/P11/P12 的计数不进棘轮基线", () => {
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { rules: Record<string, string> };
    expect(baseline.rules.P10).toBeUndefined();
    expect(baseline.rules.P11).toBeUndefined();
    expect(baseline.rules.P12).toBeUndefined();
    expect(baseline.rules.P13).toBeUndefined();
    expect(baseline.rules.P14).toBeUndefined();
    expect(baseline.rules.P15).toBeUndefined();
    expect(baseline.rules.P16).toBeUndefined();
    expect(baseline.rules.P17).toBeUndefined();
    expect(baseline.rules.P18).toBeUndefined();
    expect(baseline.rules.P19).toBeUndefined();
    expect(baseline.rules.P20).toBeUndefined();
    expect(baseline.rules.P21).toBeUndefined();
    expect(baseline.rules.P22).toBeUndefined();
    expect(baseline.rules.P23).toBeUndefined();
    expect(baseline.rules.P24).toBeUndefined();
    expect(baseline.rules.P25).toBeUndefined();
    expect(baseline.rules.P26).toBeUndefined();
    expect(baseline.rules.P27).toBeUndefined();
    expect(baseline.rules.P28).toBeUndefined();
    expect(baseline.rules.P29).toBeUndefined();
    expect(baseline.rules.P30).toBeUndefined();
    expect(baseline.rules.P31).toBeUndefined();
    expect(baseline.rules.P32).toBeUndefined();
    expect(baseline.rules.P33).toBeUndefined();
    expect(baseline.rules.P34).toBeUndefined();
    expect(baseline.rules.P35).toBeUndefined();
    expect(baseline.rules.P36).toBeUndefined();
    expect(baseline.rules.P37).toBeUndefined();
    expect(baseline.rules.P38).toBeUndefined();
    expect(baseline.rules.P39).toBeUndefined();
    expect(baseline.rules.P40).toBeUndefined();
    expect(baseline.rules.P41).toBeUndefined();
  });

  /* ── P30 / P31 / P32：本批三条硬闸（规范 §16.2.4.33 ~ §16.2.4.35）────
   *
   * 三条都同样按**形态**取锚点（错误位 + 逐条写入点、作废标志的声明与置位、
   * 响应体里亲手拼 `error`），每条都配反面用例 —— 判据太宽会逼下一个人
   * 改坏代码去迎合它（本仓库的既有教训，P29 那批踩得最深）。 */
  it("按条目共用一块错误位直接阻断（规范 P30）", () => {
    seedBaseline();
    write(
      "src/components/workshop/use-planner.ts",
      [
        "export function usePlanner(shots: Shot[]) {",
        '  const [polishError, setPolishError] = useState("");',
        "  async function polishOne(shot: Shot) {",
        '    setPolishError("");',
        "    try {",
        "      await polish(shot);",
        "    } catch (e) {",
        '      setPolishError(errorMessage(e, "润色失败"));',
        "    }",
        "  }",
        "  return { polishError, polishOne };",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P30");
    expect(output).toContain("use-planner.ts");
  });

  it("批量错误位不被 P30 计（同一时刻只有一件事会失败）", () => {
    /* `genError`（一句话生成整批角色）/ `aiError`（全片拆镜）/
     * `loadError`（一个弹窗读源码）都是**合法的单槽** —— 它们的写入点
     * 在无参的批量函数里，文件里另外那几个逐条函数与它们无关。 */
    seedBaseline();
    write(
      "src/components/workshop/use-batch.ts",
      [
        "export function useBatch(characters: Character[]) {",
        '  const [genError, setGenError] = useState("");',
        "  async function generateAll() {",
        '    setGenError("");',
        "    try {",
        "      await gen();",
        "    } catch (e) {",
        '      setGenError(errorMessage(e, "生成失败"));',
        "    }",
        "  }",
        "  async function refreshOne(character: Character) {",
        "    await refresh(character);",
        "  }",
        "  return { genError, generateAll, refreshOne };",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("忙碌位选择器（useState<string|null>）不被 P30 当错误位", () => {
    /* `polishBusyId` / `aiBusyId` 天生就是「当前是哪一条在忙」——
     * 写成单值是**正确**的（同一时刻只有一条在忙）。判据要求变量名带
     * `error` 语义，正是为了不把它们算进来。 */
    seedBaseline();
    /* 变量名刻意避开「忙碌位」的记号（`…BusyId` / `…retry…Id`）——
     * 本用例要验的是 P30（逐条挂错误），忙碌位那一族归 P37 管；
     * 用 `useState<string | null>` 且不带忙碌记号，才是一次干净的 P30 反面场景。 */
    write(
      "src/components/workshop/use-item-state.ts",
      [
        "export function useItemState(shots: Shot[]) {",
        "  const [activeId, setActiveId] = useState<string | null>(null);",
        "  async function runOne(shot: Shot) {",
        "    setActiveId(shot.id);",
        "    await run(shot);",
        "    setActiveId(null);",
        "  }",
        "  return { activeId, runOne };",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 useItemErrors 的错误位不再被 P30 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/workshop/use-planner.ts",
      [
        "export function usePlanner(shots: Shot[]) {",
        "  const errors = useItemErrors(shots.map((s) => s.id));",
        "  async function polishOne(shot: Shot) {",
        '    errors.report(shot.id)("err", "润色失败");',
        "  }",
        "  return { errors, polishOne };",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("自写「这一轮已作废」的守卫样板直接阻断（规范 P31）", () => {
    seedBaseline();
    write(
      "src/components/studio/RawFetch.tsx",
      [
        "export function useRaw() {",
        "  useEffect(() => {",
        "    let cancelled = false;",
        "    void (async () => {",
        "      const rows = await load();",
        "      if (cancelled) return;",
        "      setRows(rows);",
        "    })();",
        "    return () => {",
        "      cancelled = true;",
        "    };",
        "  }, []);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P31");
    expect(output).toContain("RawFetch.tsx");
  });

  it("只读不改的局部布尔不被 P31 计（缺置位即不算作废标志）", () => {
    seedBaseline();
    write(
      "src/components/studio/ReadOnly.tsx",
      [
        "export function useThing() {",
        "  const flag = false;",
        "  if (flag) return null;",
        "  return 1;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 beginStaleRun 的取数 effect 不再被 P31 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/Fresh.tsx",
      [
        "export function useFresh() {",
        "  useEffect(() => {",
        "    const guard = beginStaleRun();",
        "    void load().then((rows) => guard.commit(() => setRows(rows)));",
        "    return () => guard.dispose();",
        "  }, []);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("路由里手拼错误信封直接阻断（规范 P32）", () => {
    seedBaseline();
    write(
      "src/app/api/demo/route.ts",
      [
        "export async function GET() {",
        "  try {",
        "    return NextResponse.json(await build());",
        "  } catch (e) {",
        "    return NextResponse.json(",
        '      { error: errorMessage(e, "读取失败") },',
        "      { status: 500 },",
        "    );",
        "  }",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P32");
    expect(output).toContain("api/demo/route.ts");
  });

  it("自己判响应体里 error 的形状也计 P32（读侧同一枚口径）", () => {
    seedBaseline();
    write(
      "src/components/studio/raw-reader.ts",
      [
        "export function readRaw(body: unknown) {",
        '  if (isRecord(body) && typeof body.error === "string") return body.error;',
        "  return undefined;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P32");
  });

  it("本地对象字面量不被 P32 当响应信封（同形而不同源）", () => {
    /* `cacheExtractPatch({ error: errorMessage(e, "导入失败") })` 是往缓存里
     * 写一条状态记录，不是 HTTP 响应 —— 判据要求同一片段里出现「构造响应体」
     * 的动作（`NextResponse.json(` / `JSON.stringify(`）。 */
    seedBaseline();
    write(
      "src/components/workshop/State.ts",
      [
        "export function patch(state: State, e: unknown): State {",
        '  return { ...state, error: errorMessage(e, "导入失败") };',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 apiErrorBody 的路由不再被 P32 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/app/api/demo/route.ts",
      [
        "export async function GET() {",
        "  try {",
        "    return NextResponse.json(await build());",
        "  } catch (e) {",
        '    return NextResponse.json(apiErrorBody(e, "读取失败"), {',
        "      status: 500,",
        "    });",
        "  }",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 readApiError 的客户端不再被 P32 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/clean-reader.ts",
      [
        "export function readClean(body: unknown) {",
        "  return readApiError(body);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P33 / P34 / P35：本批三条硬闸（规范 §16.2.4.36 ~ §16.2.4.38）────
   *
   * 三条都按**形态**取锚点，每条都配反面用例 —— 判据太宽会逼下一个人改坏
   * 代码去迎合它（P29 那批踩得最深；本批的 P33 收窄前后各踩到一次：
   * `Date.now() + 10 * 60 * 1000` 是算截止时刻，不是 id）。 */
  it("手拼「时间戳 + 序号」的 id 直接阻断（规范 P33）", () => {
    seedBaseline();
    write(
      "src/components/studio/blank-id.ts",
      [
        "let n = 0;",
        "export function makeId(): string {",
        "  n = (n + 1) % 1_000_000;",
        "  return `msg_${Date.now().toString(36)}_${n.toString(36)}`;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P33");
    expect(output).toContain("blank-id.ts");
  });

  it("字符串拼接形态的 id 也计 P33（更差的那一半）", () => {
    seedBaseline();
    write(
      "src/components/studio/blank-concat.ts",
      'export const id = "shot-" + Date.now();\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P33");
  });

  it("只把时刻当值用不算 P33（不是 id：超时截止、SSE 心跳）", () => {
    seedBaseline();
    write(
      "src/components/studio/blank-clock.ts",
      [
        "export function poll(): void {",
        "  const deadline = Date.now() + 10 * 60 * 1000;",
        "  while (Date.now() < deadline) void tick();",
        "  send(`: hb ${Date.now()}`);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 nextId 的落点不再被 P33 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/clean-id.ts",
      [
        'import { nextId } from "~/lib/unique-id";',
        "export function makeId(): string {",
        '  return nextId("msg_");',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("自写「ComfyUI 报错 → 建议」词表直接阻断（规范 P34）", () => {
    seedBaseline();
    write(
      "src/components/studio/blank-advice.ts",
      [
        "export function advise(err: string): string {",
        "  if (/out of memory|OOM|cuda/i.test(err))",
        '    return "建议：降低 batch size 或分辨率。";',
        '  return "建议：检查 ComfyUI 服务状态后重试。";',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P34");
  });

  it("只是展示报错原文不算 P34（读过原文是对的写法）", () => {
    seedBaseline();
    write(
      "src/components/studio/blank-raw-error.ts",
      [
        "export function RawError({ error }: { error: string }) {",
        "  if (/out of memory/i.test(error)) return <pre>{error}</pre>;",
        "  return <pre>{error}</pre>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 adviseOnError 的落点不再被 P34 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/clean-advice.ts",
      [
        'import { adviseOnError } from "~/lib/comfyui/error-advice";',
        "export function advise(err: string): string | null {",
        "  return adviseOnError(err);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("亲手拼一个画布节点直接阻断（规范 P35）", () => {
    seedBaseline();
    write(
      "src/components/studio/blank-canvas.tsx",
      [
        "export function add(setNodes: SetNodes) {",
        "  setNodes((nds) => [",
        "    ...nds,",
        "    {",
        '      id: "n_1",',
        '      type: "canvasNode",',
        "      position: { x: 0, y: 0 },",
        '      data: defaultData("image"),',
        "    },",
        "  ]);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P35");
  });

  it("只改 data 的节点更新助手不算 P35（没有 position）", () => {
    seedBaseline();
    write(
      "src/components/studio/blank-node-patch.ts",
      [
        "export function patch(nodes: CanvasNodeType[], id: string) {",
        '  return nodes.map((n) => (n.id === id ? { ...n, type: "canvasNode" } : n));',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 placeCanvasNode 的落点不再被 P35 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/clean-canvas.tsx",
      [
        'import { placeCanvasNode } from "~/lib/project-canvas/canvas-helpers";',
        "export function add(setNodes: SetNodes, flow: Flow) {",
        "  setNodes((nds) =>",
        '    placeCanvasNode({ nodes: nds, flow, data: defaultData("image") }),',
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P36 / P37 / P38：本批三条硬闸（规范 §16.2.4.39 ~ §16.2.4.41）────
   *
   * 三条都按**形态**取锚点，且都**必须同时满足两个条件** —— 单数其中一半会把
   * 界面上无处不在的合法写法算进来（左内边距 / 条件渲染 / 当前选中项 /
   * 只读几何）。每条都配反面用例，且都用「先回放改造前的落点」验过判据真的
   * 抓得住（判据漏掉更差的那一半，被拦下的就永远只是合规者）。 */

  it("手写「树的缩进档 + 子行集合容器」直接阻断（规范 P36）", () => {
    seedBaseline();
    write(
      "src/components/studio/tree-view.tsx",
      [
        "const isOpen = expanded[parent];",
        "export function Tree() {",
        "  return (",
        "    <div>",
        "      {isOpen && (",
        '        <div className="mt-1 ml-3 space-y-1 border-l-2 border-dashed py-1 pl-3">',
        "          {subs.map((s) => (",
        "            <Row key={s.id} />",
        "          ))}",
        "        </div>",
        "      )}",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P36");
  });

  it("只有左内边距、没有引导线不算 P36（卡片内边距到处都是）", () => {
    seedBaseline();
    write(
      "src/components/studio/card.tsx",
      [
        "export function Card({ open }: { open: boolean }) {",
        "  return (",
        "    <div>",
        '      {open && <div className="ml-3 pl-3">内容</div>}',
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("只有引导线、没有展开判据不算 P36（静态缩进列表是合法形态）", () => {
    seedBaseline();
    write(
      "src/components/studio/static-list.tsx",
      [
        "export function List({ items }: { items: string[] }) {",
        "  return (",
        '    <ul className="ml-3 border-l-2 border-dashed pl-3">',
        "      {items.map((i) => (",
        "        <li key={i}>{i}</li>",
        "      ))}",
        "    </ul>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 TreeChildren 的落点不再被 P36 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/tree-clean.tsx",
      [
        'import { TreeChildren } from "~/components/ui/tree-rows";',
        "export function Tree({ isOpen, subs }: Props) {",
        "  return (",
        "    <div>",
        "      {isOpen && (",
        "        <TreeChildren depth={1}>",
        "          {subs.map((s) => (",
        "            <Row key={s.id} />",
        "          ))}",
        "        </TreeChildren>",
        "      )}",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("自写「某一条在忙」的执行态直接阻断（规范 P37）", () => {
    seedBaseline();
    write(
      "src/components/workshop/busy-list.tsx",
      [
        "export function List({ items, busyId }: Props) {",
        "  return (",
        "    <ul>",
        "      {items.map((item) => (",
        "        <li key={item.id} data-busy={busyId === item.id} />",
        "      ))}",
        "    </ul>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P37");
  });

  it("控制器里声明的忙碌位也计 P37（声明与比较可能分处两个文件）", () => {
    seedBaseline();
    write(
      "src/components/workshop/hooks/use-thing.ts",
      [
        'import { useState } from "react";',
        "export function useThing() {",
        "  const [polishBusyId, setPolishBusyId] = useState<string | null>(null);",
        "  return { polishBusyId, setPolishBusyId };",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P37");
  });

  it("「当前选中项」不算 P37（useState<string|null> 到处都是合法写法）", () => {
    seedBaseline();
    write(
      "src/components/studio/selection.tsx",
      [
        "export function Menu({ items, activeId }: Props) {",
        "  return (",
        "    <ul>",
        "      {items.map((item) => (",
        "        <li key={item.id} data-active={activeId === item.id} />",
        "      ))}",
        "    </ul>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 useItemAction 的落点不再被 P37 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/workshop/busy-clean.tsx",
      [
        'import { useItemAction } from "~/components/ui/use-item-action";',
        "export function List({ items }: Props) {",
        "  const action = useItemAction(items.map((i) => i.id));",
        "  return (",
        "    <ul>",
        "      {items.map((item) => (",
        "        <li key={item.id} data-busy={action.isBusy(item.id)} />",
        "      ))}",
        "    </ul>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("手写两个 rect 相减的面板内偏移直接阻断（规范 P38）", () => {
    seedBaseline();
    write(
      "src/components/studio/scroll-to.ts",
      [
        "export function scrollToRow(panel: HTMLElement, row: HTMLElement) {",
        "  const top = row.getBoundingClientRect().top - panel.getBoundingClientRect().top;",
        "  panel.scrollTop = Math.max(0, panel.scrollTop + top - 8);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P38");
  });

  it("按行数估行高也计 P38（除数为 0 时给出 Infinity）", () => {
    seedBaseline();
    write(
      "src/components/studio/jump-line.ts",
      [
        "export function jumpToLine(el: HTMLTextAreaElement, line: number, lines: string[]) {",
        "  const lineHeight = el.scrollHeight / lines.length;",
        "  el.scrollTo({ top: line * lineHeight });",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P38");
  });

  it("自己接 ResizeObserver 量盒子也计 P38（量测接线各写一遍）", () => {
    seedBaseline();
    write(
      "src/components/studio/measure.ts",
      [
        "export function useSize(el: HTMLElement, set: (s: Size) => void) {",
        "  const sync = () => {",
        "    const rect = el.getBoundingClientRect();",
        "    set((prev) =>",
        "      prev.width === rect.width ? prev : { width: rect.width },",
        "    );",
        "  };",
        "  sync();",
        "  const observer = new ResizeObserver(sync);",
        "  observer.observe(el);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P38");
  });

  it("只读尺寸不写（对齐检查）不算 P38（更差的一半是先减了再滚）", () => {
    seedBaseline();
    write(
      "src/components/studio/audit.ts",
      [
        "export function overlaps(a: HTMLElement, b: HTMLElement) {",
        "  const ra = a.getBoundingClientRect();",
        "  const rb = b.getBoundingClientRect();",
        "  return ra.bottom > rb.top && ra.top < rb.bottom;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("用 ResizeObserver 观测内容变化不算 P38（React Flow 的约定用法）", () => {
    seedBaseline();
    write(
      "src/components/studio/wire-flow.ts",
      [
        "export function watchNode(el: HTMLElement, update: () => void) {",
        "  const observer = new ResizeObserver(() => update());",
        "  observer.observe(el);",
        "  return () => observer.disconnect();",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 offsetWithin 的落点不再被 P38 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/scroll-clean.ts",
      [
        'import { offsetWithin } from "~/lib/dom-rect";',
        "export function scrollToRow(panel: HTMLElement, row: HTMLElement) {",
        "  const top = offsetWithin(row, panel);",
        "  if (top === null) return;",
        "  panel.scrollTop = Math.max(0, panel.scrollTop + top - 8);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P39 / P40 / P41：本批三条硬闸（规范 §16.2.4.42 ~ §16.2.4.44）────
   *
   * 三条同样按**形态**取锚点，且都排除了「形态相近、语义不同」的合法写法：
   *   · P39 排除帧循环（`step` 自递归采样器，不是「等一帧」）；
   *   · P40 排除出口自身的实现与「纯编排 / 域转发」两层；
   *   · P41 排除字段级校验（`BodySchema` 那类域判据）与出口自身。
   * 每条都配反面用例。 */

  it("裸写 requestAnimationFrame 调度直接阻断（规范 P39）", () => {
    seedBaseline();
    write(
      "src/components/studio/after-frame.ts",
      [
        "export function recenter(el: HTMLElement) {",
        "  requestAnimationFrame(() => {",
        '    el.scrollIntoView({ block: "nearest" });',
        "  });",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P39");
  });

  it("帧循环（回调里再次 rAF 自己）不算 P39（那是采样器，不是等一帧）", () => {
    seedBaseline();
    write(
      "src/components/studio/hooks/use-fps.ts",
      [
        "export function useFps() {",
        "  let raf = 0;",
        "  const tick = (now: number) => {",
        "    sample(now);",
        "    raf = requestAnimationFrame(tick);",
        "  };",
        "  raf = requestAnimationFrame(tick);",
        "  return () => cancelAnimationFrame(raf);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("走 onNextFrame 的落点不再被 P39 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/after-frame.ts",
      [
        'import { onNextFrame } from "~/lib/next-frame";',
        "export function recenter(el: HTMLElement) {",
        "  return onNextFrame(() => {",
        '    el.scrollIntoView({ block: "nearest" });',
        "  });",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("裸调 copyText 而不接反馈出口直接阻断（规范 P40）", () => {
    seedBaseline();
    write(
      "src/components/studio/copy-all.tsx",
      [
        'import { copyText } from "~/lib/browser-io";',
        "export function CopyAll({ text }: { text: string }) {",
        "  return <Button onClick={() => void copyText(text)}>复制</Button>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P40");
  });

  it("走 useCopyFeedback 的落点不再被 P40 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/copy-all.tsx",
      [
        'import { useCopyFeedback } from "~/components/ui/use-copy-feedback";',
        "export function CopyAll({ text }: { text: string }) {",
        '  const copy = useCopyFeedback({ onFailure: "silent" });',
        "  return <Button onClick={() => copy(text)}>复制</Button>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("在 lib 层裸调 copyText 也计 P40（这条账横跨两侧）", () => {
    seedBaseline();
    write(
      "src/lib/media/upload-client.ts",
      [
        'import { copyText } from "~/lib/browser-io";',
        "export async function copyLink(url: string) {",
        "  await copyText(url);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P40");
  });

  it("REST 路由自己定义 isRecord 直接阻断（规范 P41）", () => {
    seedBaseline();
    write(
      "src/app/api/widgets/route.ts",
      [
        "function isRecord(v: unknown): v is Record<string, unknown> {",
        '  return typeof v === "object" && v !== null;',
        "}",
        "export async function POST(req: Request) {",
        "  const body = await req.json();",
        "  if (!isRecord(body)) {",
        '    return NextResponse.json({ error: "请求体必须是对象" }, { status: 400 });',
        "  }",
        "  return NextResponse.json({ ok: true });",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P41");
  });

  it("手写「取 JSON + 400 信封」但不定义 isRecord 也计 P41", () => {
    seedBaseline();
    write(
      "src/app/api/widgets/route.ts",
      [
        "export async function POST(req: Request) {",
        "  let body: unknown;",
        "  try {",
        "    body = await req.json();",
        "  } catch {",
        '    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });',
        "  }",
        "  return NextResponse.json({ ok: true });",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P41");
  });

  it("走 readJsonRecord 的 REST 路由不再被 P41 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/app/api/widgets/route.ts",
      [
        'import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";',
        "export async function POST(req: Request) {",
        "  const body = await readJsonRecord(req);",
        "  if (isErrorResponse(body)) return body;",
        "  return NextResponse.json({ ok: true, kind: body.kind });",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P42：错误文案的「动作前缀」（规范 §16.2.4.45）────────────────────
   *
   * 判据取「**动作前缀 + 冒号 + 紧跟一个错误取值动作**」这个签名。
   * 两个条件必须同时成立：只数冒号会把任何「标题：正文」的界面文案算上，
   * 只数 `String(` 会把日志里别的转换算上。 */

  it("自拼「动作前缀 + 错误详情」直接阻断（规范 P42）", () => {
    seedBaseline();
    write(
      "src/components/studio/workflow-library/hooks/use-import.ts",
      [
        "export function load() {",
        "  try {",
        "    run();",
        "  } catch (e) {",
        '    return "无法读取文件：" + errorMessage(e, "未知错误");',
        "  }",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P42");
  });

  it("`String(e)` 绕开取值出口的那一档同样计 P42（更差的那种也要数）", () => {
    /* 这条账里**更差**的一半正是这一档：`String(e)` 对 `new Error("")` 产出
     * `"Error"`、对 tRPC 投出的普通对象产出 `"[object Object]"`，
     * 而且绕过网络层翻译。判据只认「后面跟着一个错误取值动作」这个签名，
     * 两种写法都在内。 */
    seedBaseline();
    write(
      "src/components/studio/custom-nodes/hooks/use-settings.ts",
      [
        "export function save() {",
        "  try {",
        "    run();",
        "  } catch (e) {",
        '    setError("读取配置失败：" + String(e));',
        "  }",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P42");
  });

  it("走 errorText 的落点不再被 P42 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/workflow-library/hooks/use-import.ts",
      [
        'import { errorText } from "~/lib/error-message";',
        "export function load() {",
        "  try {",
        "    run();",
        "  } catch (e) {",
        '    return errorText(e, "无法读取文件");',
        "  }",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("「标题：正文」的普通界面文案不算 P42（判据太宽会逼人改坏文案）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/Hint.tsx",
      [
        "export function Hint() {",
        '  return <p>{"导出失败：请检查磁盘空间"}</p>;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("动作名当 errorMessage 的 fallback 不算 P42（那一档结果本就正确）", () => {
    /* `errorMessage(e, "保存失败")` 的产物就是「保存失败」，没有拼前缀 ——
     * 它表达不了「动作 + 详情」两段式，但也不是这条账要消灭的写法。 */
    seedBaseline();
    write(
      "src/components/studio/panels/badge.ts",
      [
        'import { errorMessage } from "~/lib/error-message";',
        "export function text(e: unknown) {",
        '  return errorMessage(e, "保存失败");',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P43：复制失败的固定提示句（规范 §16.2.4.46）──────────────────────
   *
   * 这是 P40 的下一层：P40 管「成败说不说」，P43 管「说了什么」。
   * 判据取固定句的**语义内核**「剪贴板不可用」，而不取标题「复制失败」。 */

  it("手写「剪贴板不可用」那一句直接阻断（规范 P43）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/CopyRow.tsx",
      [
        "export function CopyRow({ failed }: { failed: boolean }) {",
        '  return <span title={failed ? "复制失败：剪贴板不可用，请手动选中后复制" : "复制"} />;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P43");
  });

  it("走 copyFailureText 的落点不再被 P43 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/CopyRow.tsx",
      [
        'import { copyFailureText } from "~/components/ui/use-copy-feedback";',
        "export function CopyRow({ failed }: { failed: boolean }) {",
        "  return <span title={failed ? copyFailureText() : '复制'} />;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("只说标题「复制失败」不点出剪贴板原因的不算 P43（各面板本来就该说不一样）", () => {
    /* 判据太宽会逼人把每处标题都改成同一句 —— 而标题恰恰该保留面板自己的
     * 说法（与 `errorText` 同款：动作前缀是调用处的事）。 */
    seedBaseline();
    write(
      "src/components/studio/panels/CopyRow.tsx",
      [
        "export function CopyRow({ failed }: { failed: boolean }) {",
        '  return <span title={failed ? "复制失败，请重试" : "复制"} />;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P44：把一段文本按最大长度截断（规范 §16.2.4.48）──────────────────
   *
   * 这条账的**边界**最要紧：本仓库里 `slice(0, 8)` / `slice(0, 12)` 大量出现
   * 在「id / sha 短码」上，那些不是「文本被切了一刀」。判据取 **N ≥ 24**
   * 来分开这两档。 */

  it("手写文本截断（slice + 省略号）直接阻断（规范 P44）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/Title.tsx",
      [
        "export function Title({ p }: { p: string }) {",
        "  return <span>{p.length > 40 ? `${p.slice(0, 40)}…` : p}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P44");
  });

  it("走 clampText 的落点不再被 P44 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/Title.tsx",
      [
        'import { TITLE_MAX, clampText } from "~/lib/text-clamp";',
        "export function Title({ p }: { p: string }) {",
        "  return <span>{clampText(p, { maxLength: TITLE_MAX })}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("id / sha 短码的 slice(0, 8) 不被 P44 误伤（那是完整标识，不是「被切了」）", () => {
    /* 这是本条判据的**边界**：短码旁边的 `…` 是显示约定，不是「这段被截断」。
     * 判据取 N ≥ 24，就是为把它们分开 —— 太宽会把 20+ 处短码全算成违规。 */
    seedBaseline();
    write(
      "src/components/studio/panels/Ids.tsx",
      [
        "export const short = (id: string) => `${id.slice(0, 8)}…`;",
        "export const hash = (h: string) => `${h.slice(0, 12)}…`;",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("注释里提到截断不算实现（与 P1 同一份剥离）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/Documented.tsx",
      "/* 这里此前是 `${p.slice(0, 40)}…`，已改走 text-clamp 的 clampText。 */\nexport const D = () => null;\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P45：一个异步动作重试几次、退避多久（规范 §16.2.4.49）────────────
   *
   * 判据取**指数退避的算术** `* 2 ** …` —— 它在本仓库与「退避」一一对应。
   * 固定间隔一侧**不**做机器判据（`for (let i = 0; i < 5; i++)` 太常见，
   * 数它只会逼人把循环写成别的形状去迎合判据）。 */

  it("自写指数退避算术直接阻断（规范 P45）", () => {
    seedBaseline();
    write(
      "src/lib/comfyui/ws-reconnect-extra.ts",
      [
        "export function nextDelay(attempt: number): number {",
        "  return Math.min(1000 * 2 ** attempt, 15000);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P45");
  });

  it("走 backoffDelayMs 的落点不再被 P45 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/lib/comfyui/ws-reconnect-extra.ts",
      [
        'import { WS_RECONNECT, backoffDelayMs } from "~/lib/retry-policy";',
        "export function nextDelay(attempt: number): number {",
        "  return backoffDelayMs({ ...WS_RECONNECT, attempt });",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("普通的平方运算不算退避（P45 只认「2 的幂」这个签名）", () => {
    seedBaseline();
    write(
      "src/lib/geometry.ts",
      "export const area = (r: number) => Math.PI * 2 * r;\nexport const square = (x: number) => x * x;\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P46：手拼日期串（规范 §16.2.4.50）────────────────────────────── */

  it("手拼日期串直接阻断（规范 P46）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/Day.tsx",
      [
        "export const day = (d: Date) => {",
        '  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;',
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P46");
  });

  it("走 formatDate 家族的落点不再被 P46 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/Day.tsx",
      [
        'import { formatDate } from "~/lib/time-format";',
        "export const day = (d: Date) => formatDate(d);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("同天判定里的 getMonth()/getDate() 比较不被 P46 误伤（那不是「拼日期串」）", () => {
    seedBaseline();
    write(
      "src/components/studio/panels/SameDay.ts",
      [
        "export const same = (a: Date, b: Date) =>",
        "  a.getFullYear() === b.getFullYear() &&",
        "  a.getMonth() === b.getMonth() &&",
        "  a.getDate() === b.getDate();",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P47：扩展名 ⇄ MIME 映射表（规范 §16.2.4.51）───────────────────
   *
   * 判据锚**映射表的形态**（`"image/x": "ext"` / `".ext": "image/x"`），
   * 不数单个 `?? "image/png"` 兜底 —— 那是调用处的域选择。 */

  it("自写扩展名 ⇄ MIME 映射表直接阻断（规范 P47）", () => {
    seedBaseline();
    write(
      "src/app/api/thing/route.ts",
      [
        "const MIME_BY_EXT: Record<string, string> = {",
        '  ".png": "image/png",',
        '  ".mp4": "video/mp4",',
        "};",
        "export const pick = (e: string) => MIME_BY_EXT[e];",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P47");
  });

  it("走 mime-ext 出口的落点不再被 P47 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/app/api/thing/route.ts",
      [
        'import { mimeForExt } from "~/lib/media/mime-ext";',
        "export const pick = (e: string) => mimeForExt(e);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("单个 MIME 兜底字面量不算 P47（那是调用处的域选择，不是一张表）", () => {
    seedBaseline();
    write(
      "src/app/api/thing/route.ts",
      ['export const fallback = (m: string | null) => m ?? "image/png";'].join(
        "\n",
      ),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P48：unknown 当宽松对象视图（规范 §16.2.4.52）─────────────────────
   *
   * 判据锚**转成视图**的那一处形态（`typeof X === "object" && X !== null`
   * 之后紧跟 `as Record<string, unknown>`，同一变量名）。刻意**不数**另外
   * 两种形态 —— 「就地读一个字段」与「取反早退守卫」，它们套出口只会更绕。 */

  it("自写 unknown → 宽松对象视图直接阻断（规范 P48）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function asThing(v: unknown): Record<string, unknown> | null {",
        '  return typeof v === "object" && v !== null',
        "    ? (v as Record<string, unknown>)",
        "    : null;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P48");
  });

  it("走 asRecord 出口的落点不再被 P48 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        'import { asRecord } from "~/lib/is-record";',
        "export const name = (v: unknown) => asRecord(v)?.name;",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("「就地读一个字段」（typeof + in 判据）不算 P48", () => {
    /* `typeof e === "object" && e !== null && "message" in e` 是就地读字段：
     * 套出口要写成 `asRecord(e)?.message` 再判类型，反而多一层。
     * 第一版判据把它算进来，一次报出 24 处，一半是它。 */
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function msg(e: unknown): string {",
        '  if (typeof e === "object" && e !== null && "message" in e) {',
        "    return String((e as { message: unknown }).message);",
        "  }",
        '  return "";',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("「取反早退」的守卫不算 P48（收窄后立刻用掉，没有视图这回事）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function read(body: unknown): string | null {",
        '  if (typeof body !== "object" || body === null) return null;',
        '  return String((body as { detail?: unknown }).detail ?? "");',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P49：文件名安全化（规范 §16.2.4.53）─────────────────────────────
   *
   * 判据锚 `replace(/[^…]/g, "_")` 这一条替换形态 —— 精确到「把一批字符
   * 换成下划线」，不数别的 `replace`（`.` → `-`、空格归一都不在此列）。 */

  it("自写「非法字符换下划线」的文件名安全化直接阻断（规范 P49）", () => {
    seedBaseline();
    write(
      "src/server/thing.ts",
      ['export const safe = (n: string) => n.replace(/[^\\w.-]/g, "_");'].join(
        "\n",
      ),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P49");
  });

  it("走 safe-name 出口的落点不再被 P49 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/server/thing.ts",
      [
        'import { safeFileNameSegment } from "~/lib/safe-name";',
        "export const safe = (n: string) => safeFileNameSegment(n);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("别的 replace（空格归一 / 去掉尾斜杠）不算 P49", () => {
    seedBaseline();
    write(
      "src/server/thing.ts",
      [
        'export const norm = (n: string) => n.replace(/\\s+/g, " ").trim();',
        'export const strip = (u: string) => u.replace(/\\/+$/, "");',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P50：数字精度格式化（规范 §16.2.4.54）──────────────────────────
   *
   * 判据锚 `toFixed(` 这个 API 本身 —— 它是本条账唯一的签名
   *（`Math.round(v * 100) / 100` 那类写法里也必然有一个 `toFixed`）。 */

  it("自写数字精度格式化直接阻断（规范 P50）", () => {
    seedBaseline();
    write(
      "src/components/settings/thing.tsx",
      ["export const show = (v: number) => `${v.toFixed(2)}px`;"].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P50");
  });

  it("走 number-format 出口的落点不再被 P50 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/settings/thing.tsx",
      [
        'import { fixed } from "~/lib/number-format";',
        'export const show = (v: number) => `${fixed(v, 2) ?? ""}px`;',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("像素取整（Math.round / padStart）不算 P50（那是别的账）", () => {
    /* 判据太宽会逼人改坏代码：`Math.round(x)` 与 `String(n).padStart(2, "0")`
     * 在本仓库大量用在坐标取整与补零上，它们**不是**「按某档精度写数」。 */
    seedBaseline();
    write(
      "src/components/settings/thing.tsx",
      [
        "export const snap = (v: number) => Math.round(v / 8) * 8;",
        'export const pad = (v: number) => String(v).padStart(2, "0");',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P51：去重合并 / 区域设置排序（规范 §16.2.4.55）───────────────── */

  it("自写区域设置排序直接阻断（规范 P51）", () => {
    seedBaseline();
    write(
      "src/components/settings/thing.tsx",
      [
        "export const list = (xs: string[]) =>",
        "  [...new Set(xs)].sort((a, b) => a.localeCompare(b));",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P51");
  });

  it("走 ordered-set 出口的落点不再被 P51 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/settings/thing.tsx",
      [
        'import { uniqueSorted } from "~/lib/ordered-set";',
        "export const list = (xs: string[]) => uniqueSorted(xs);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("数值比较器与不带比较器的 sort（码位序）不算 P51", () => {
    /* 「按当前区域设置」与「按字符串码位」是**两种判据**：后者在不带比较器
     * 的 `.sort()` 里是合法且另有所指的写法，数进来会逼人改坏代码。 */
    seedBaseline();
    write(
      "src/components/settings/thing.tsx",
      [
        "export const byCount = (xs: number[]) => [...xs].sort((a, b) => b - a);",
        "export const byCode = (xs: string[]) => [...xs].sort();",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P52：data URL（规范 §16.2.4.56）──────────────────────────────── */

  it("自拼 data URL 直接阻断（规范 P52）", () => {
    seedBaseline();
    write(
      "src/server/thing.ts",
      [
        "export const inline = (b64: string, mime: string) =>",
        "  `data:${mime};base64,${b64}`;",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P52");
  });

  it("自切 data URL 载荷（indexOf 逗号）直接阻断（规范 P52）", () => {
    seedBaseline();
    write(
      "src/server/thing.ts",
      [
        "export const payload = (url: string) =>",
        '  url.slice(url.indexOf(",") + 1);',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P52");
  });

  it("更差的那种写法（split 逗号）也数得到 —— 与 data: 同现才计 P52", () => {
    /* 与 P13「只数合规的那种、漏掉更差的那种」同款：判据漏掉更差的写法，
     * 被拦下的就永远只是合规者。但 `split(",")` 另有 CSV 解析的用法，
     * 故要求与 `data:` 前缀同现。 */
    seedBaseline();
    write(
      "src/server/thing.ts",
      [
        "export const payload = (url: string) => {",
        '  if (!url.startsWith("data:")) return null;',
        '  return url.split(",")[1] ?? null;',
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P52");
  });

  it("CSV 解析里的 split 逗号不算 P52（同文件没有 data: 前缀）", () => {
    seedBaseline();
    write(
      "src/server/thing.ts",
      [
        "export const names = (raw: string) =>",
        '  raw.split(",").map((x) => x.trim());',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it('SSE 帧前缀 startsWith("data:") 不算 P52（那是流式解析）', () => {
    seedBaseline();
    write(
      "src/lib/llm/thing.ts",
      [
        "export const frame = (line: string) => {",
        '  if (!line.startsWith("data:")) return null;',
        "  return line.slice(5).trim();",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("走 data-url 出口的落点不再被 P52 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/server/thing.ts",
      [
        'import { base64PayloadOf, toDataUrl } from "~/lib/media/data-url";',
        "export const inline = (bytes: Uint8Array, mime: string) =>",
        "  toDataUrl(bytes, mime);",
        "export const payload = (url: string) => base64PayloadOf(url);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  /* ── P53：键盘键判据（规范 §16.2.4.57）───────────────────────────── */

  it("手写 event.key 字面量比对直接阻断（规范 P53）", () => {
    seedBaseline();
    write(
      "src/components/studio/key.tsx",
      [
        "export function K({ run }: { run: () => void }) {",
        "  return (",
        '    <div role="tab" onKeyDown={(e) => { if (e.key === "Enter") run(); }} />',
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P53");
  });

  it("反向比对（!== 字面量）同样计入 P53（同一形态的两半）", () => {
    seedBaseline();
    write(
      "src/components/studio/key.tsx",
      [
        "export const isTab = (e: { key: string }) => {",
        '  if (e.key !== "Tab") return false;',
        "  return true;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P53");
  });

  it("走 simpleKeyHandler 的落点不再被 P53 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/key.tsx",
      [
        'import { simpleKeyHandler } from "~/components/ui/simple-key-handler";',
        "export function K() {",
        '  return <div role="tab" {...simpleKeyHandler(["Space", "Enter"], () => {})} />;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  it("走 ~/lib/keyboard 归一的落点不再被 P53 计（两个出口共用一个判据）", () => {
    seedBaseline();
    write(
      "src/components/studio/key.ts",
      [
        'import { KEY, isKeyIn } from "~/lib/keyboard";',
        "export const hit = (key: string) => isKeyIn(key, [KEY.Space, KEY.Enter]);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("入口自身与 use-enter-commit / use-hotkey 不被 P53 误伤（显式豁免）", () => {
    seedBaseline();
    write(
      "src/lib/keyboard.ts",
      'export const isEnter = (key: string) => key === "Enter";\n',
    );
    write(
      "src/components/ui/simple-key-handler.ts",
      'export const isEnter = (event: { key: string }) => event.key === "Enter";\n',
    );
    write(
      "src/components/ui/use-enter-commit.ts",
      'export const isCommit = (event: { key: string }) => event.key === "Enter";\n',
    );
    write(
      "src/components/ui/use-hotkey.ts",
      'export const isEsc = (event: { key: string }) => event.key === "Escape";\n',
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P54：SGR 转义序列（规范 §16.2.4.58）─────────────────────────── */

  it("自写 SGR 转义序列直接阻断（规范 P54）", () => {
    seedBaseline();
    write(
      "src/lib/log/thing.ts",
      [
        "export const SGR_RE = /\\x1b\\[[0-9;:]*m/g;",
        'export const strip = (t: string) => t.replace(SGR_RE, "");',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P54");
  });

  it("u001b 转义写法（`\\u001b`）同样计入 P54（同一形态的两种字面量）", () => {
    seedBaseline();
    write("src/lib/log/thing.ts", 'export const RESET = "\\u001b[0m";\n');
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P54");
  });

  it("走 log-ansi 出口的落点不再被 P54 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/logs/thing.ts",
      [
        'import { hasSgr, stripSgr } from "~/lib/log/log-ansi";',
        "export const on = (t: string) => hasSgr(t);",
        "export const clean = (t: string) => stripSgr(t);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("出口自身（lib/log/log-ansi.ts）不被 P54 误伤（显式豁免）", () => {
    seedBaseline();
    write(
      "src/lib/log/log-ansi.ts",
      [
        "export const SGR_RE = /\\x1b\\[[0-9;:]*m/g;",
        'export const strip = (t: string) => t.replace(SGR_RE, "");',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("单独的 \\x1b（光标移动等，不带 [Nm 形态）不算 P54（另一条账）", () => {
    seedBaseline();
    write(
      "src/lib/log/thing.ts",
      [
        'export const moveCursor = (t: string) => t.replace(/\\x1b\\[/g, "");',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P55：书写法换算（规范 §16.2.4.59）───────────────────────────── */

  it("自写驼峰 → kebab 换算直接阻断（规范 P55）", () => {
    seedBaseline();
    write(
      "src/lib/shell/thing.ts",
      [
        "export const kebab = (tone: string) =>",
        "  tone.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P55");
  });

  it("走 case-token 出口的落点不再被 P55 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/lib/shell/thing.ts",
      [
        'import { toKebabCase } from "~/lib/case-token";',
        "export const kebab = (tone: string) => toKebabCase(tone);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("别的 [A-Z] 用法不算 P55（大写化 / 校验正则不是本条账）", () => {
    seedBaseline();
    write(
      "src/lib/shell/thing.ts",
      [
        "export const upper = (t: string) => t.toUpperCase();",
        "export const isUpper = (t: string) => /^[A-Z]+$/.test(t);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P56：路径展示（规范 §16.2.4.60）─────────────────────────────── */

  it("服务端手工相对化路径直接阻断（规范 P56）", () => {
    seedBaseline();
    write(
      "src/app/api/logs/list/route.ts",
      [
        "import path from 'node:path';",
        "export const R = () => path.relative('/a', '/a/b');",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P56");
  });

  it("取末段（split pop）与反斜杠归一都计入 P56（同一形态的两种写法）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export const tail = (p: string) => p.split(/[\\\\/]/).pop();",
        "export const slash = (p: string) => p.replace(/\\\\/g, '/');",
        "export const tail2 = (p: string) => p.split('/').pop();",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P56");
  });

  it("走 path-display 出口的落点不再被 P56 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        'import { toDisplayPath, normalizeSlashes } from "~/lib/path-display";',
        "export const d = (p: string) => toDisplayPath(p);",
        "export const s = (p: string) => normalizeSlashes(p);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it('包含判据（startsWith("..") / isAbsolute）不算 P56（那不是展示）', () => {
    seedBaseline();
    write(
      "src/app/api/debug/source/route.ts",
      [
        "import path from 'node:path';",
        "export const inRoot = (root: string, p: string) => {",
        "  const rel = path.relative(root, p);",
        '  return !rel.startsWith("..") && !path.isAbsolute(rel);',
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P57：props 透传（规范 §16.2.4.61）───────────────────────────── */

  it("基元自写 props 剔除表直接阻断（规范 P57）", () => {
    seedBaseline();
    write(
      "src/components/ui/thing.tsx",
      [
        "import * as React from 'react';",
        'interface P extends Omit<React.ComponentProps<"input">, "value" | "onChange"> { value: number }',
        "export function T({ value, onChange, ...rest }: P) {",
        "  return <input {...rest} value={value} onChange={onChange} />;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P57");
  });

  it("走 dom-props 出口的落点不再被 P57 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/ui/thing.tsx",
      [
        "import * as React from 'react';",
        'import { type OmitOwnProps } from "~/lib/dom-props";',
        "const OWN = ['value', 'onChange'] as const;",
        "interface P extends OmitOwnProps<React.ComponentProps<'input'>, (typeof OWN)[number]> { value: number }",
        "export function T({ value, onChange, ...rest }: P) {",
        "  return <input {...rest} value={value} onChange={onChange} />;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("数据模型的 Omit（Omit<LogEntry, 'seq'>）不算 P57（不是 DOM 属性）", () => {
    seedBaseline();
    write(
      "src/components/ui/thing.ts",
      [
        "interface LogEntry { id: string; seq: number }",
        'export type New = Omit<LogEntry, "id" | "seq">;',
        'export type One = Omit<LogEntry, "id">;',
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P58：异步超时（规范 §16.2.4.62）─────────────────────────────── */

  it("Promise.race + setTimeout 的超时样板直接阻断（规范 P58）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function withT<T>(p: Promise<T>, ms: number) {",
        "  let timer: ReturnType<typeof setTimeout>;",
        "  const t = new Promise<never>((_, reject) => {",
        "    timer = setTimeout(() => reject(new Error('timeout')), ms);",
        "  });",
        "  return Promise.race([p, t]).finally(() => clearTimeout(timer));",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P58");
  });

  it("定时器在回调里结算 Promise（不用 race）也计入 P58", () => {
    /* 这一档**不用** `Promise.race`，靠「谁先结算谁算数」，一样要清定时器、
     * 一样各写各的（`waitForImage` / `runFFmpeg` / `waitForDetachMediator`）。 */
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function wait(ms: number, onDone: () => void) {",
        "  return new Promise<string>((resolve) => {",
        "    const timer = setTimeout(() => resolve('timeout'), ms);",
        "    onDone();",
        "    return timer;",
        "  }).finally(() => clearTimeout(timer));",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P58");
  });

  it("结算助手（finish / settle / done）写法的超时也计入 P58", () => {
    /* `waitForDetachMediator` 把「这一轮结束」收成 `finish()`，定时器到点调它 ——
     * 只看 `resolve(` 会漏掉这一档。 */
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function wait(child: { once: (e: string, f: () => void) => void }) {",
        "  return new Promise<number | null>((resolve) => {",
        "    let settled = false;",
        "    const finish = (v: number | null) => { if (settled) return; settled = true; resolve(v); };",
        "    child.once('exit', () => finish(0));",
        "    const timer = setTimeout(() => finish(null), 5000);",
        "    return timer;",
        "  }).finally(() => clearTimeout(timer));",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P58");
  });

  it("走 with-timeout 出口的落点不再被 P58 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        'import { withTimeout } from "~/lib/with-timeout";',
        "export const w = <T,>(p: Promise<T>, ms: number) =>",
        "  withTimeout(p, ms, { message: '慢' });",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("两路来源抢跑（Promise.race 但无 setTimeout）不算 P58（那不是超时）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export const fastest = async (a: Promise<number>, b: Promise<number>) => {",
        "  const w = await Promise.race([a, b]);",
        "  return w;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("看门狗 / 防抖（setTimeout 到点做事、不结算 Promise）不算 P58", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function arm(kick: () => void, ms: number) {",
        "  const timer = setTimeout(() => {",
        "    void kick();",
        "  }, ms);",
        "  return timer;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P59：数值夹取（规范 §16.2.4.63）─────────────────────────────── */

  it("手写 Math.min / Math.max 嵌套的夹取直接阻断（规范 P59）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export function pick(page: number, total: number) {",
        "  return Math.min(Math.max(1, page), total);",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P59");
  });

  it("两种参数顺序都计入 P59（它们类型上不可分辨）", () => {
    /* `clamp(x, min, max)` 与 `clamp(min, max, x)` 都是
     * `(number, number, number) => number` —— 传反了不会报错。
     * 手写版的两种顺序同样都该被数到。 */
    seedBaseline();
    write(
      "src/lib/a.ts",
      "export const a = (z: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, z));\n",
    );
    write(
      "src/lib/b.ts",
      "export const b = (z: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, z));\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("src/lib/a.ts");
    expect(output).toContain("src/lib/b.ts");
  });

  it("多行写法与取整混入都计入 P59", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export const snap = (v: number, m: number) =>",
        "  Math.max(",
        "    MIN,",
        "    Math.min(MAX, Math.round(v / m) * m),",
        "  );",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P59");
  });

  it("走 clamp 出口的落点不再被 P59 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        'import { clamp } from "~/lib/clamp";',
        "export const pick = (page: number, total: number) =>",
        "  clamp(page, 1, total);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("同一种 Math 的嵌套（max 里包 max）不算 P59（那是取值不是夹取）", () => {
    /* `Math.max(1, 1 / Math.max(zoom, 0.01))` 是取值 —— 只数
     * 「两种不同」的 Math 函数嵌套。 */
    seedBaseline();
    write(
      "src/lib/thing.ts",
      "export const s = (zoom: number) => Math.max(1, 1 / Math.max(zoom, 0.01));\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("半个夹取（Math.max(0, x) 只有一个边界）不算 P59", () => {
    /* 那表达的是「不许为负」，不是「放进区间」—— 换成
     * `clamp(x, 0, Infinity)` 只会更绕。 */
    seedBaseline();
    write(
      "src/lib/thing.ts",
      "export const i = (n: number, len: number) => Math.max(0, len - n);\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("出口自身的实现（lib/clamp.ts）不被 P59 计", () => {
    seedBaseline();
    write(
      "src/lib/clamp.ts",
      [
        "export function clamp(v: number, min: number, max: number) {",
        "  if (Number.isNaN(v)) return min;",
        "  if (v < min) return min;",
        "  return Math.min(max, Math.max(min, v));",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P60：大写归一（规范 §16.2.4.64）─────────────────────────────── */

  it('`(x ?? "").toUpperCase()` 形态直接阻断（规范 P60）', () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      "export const t = (mode?: string) => (mode ?? '').toUpperCase();\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P60");
  });

  it("`.trim().toUpperCase()` 形态也计入 P60（同一条账的另一种写法）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      "export const t = (mode: string) => mode.trim().toUpperCase();\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P60");
  });

  it("两面都写的形态只计一次（不重复计）", () => {
    /* `(x ?? "").trim().toUpperCase()` 同时命中两个子形态，
     * 去重后应按 1 处记 —— 否则「收紧基线」会把同一行数两遍。 */
    seedBaseline();
    write(
      "src/lib/thing.ts",
      "export const t = (mode?: string) => (mode ?? '').trim().toUpperCase();\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toMatch(/thing\.ts（1 处）/);
  });

  it("走 upper-token 出口的落点不再被 P60 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        'import { upperToken } from "~/lib/upper-token";',
        "export const t = (mode?: string) => upperToken(mode);",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("裸 `x.toUpperCase()`（x 是已知值、只作大写展示）不算 P60", () => {
    /* 那不是「归一外来串」而是「把已知值画成大写」。数进来会逼人改坏代码
     *（`log-store` 的行内级别、`StyleSwitcher` 的档名展示都是这一档）。 */
    seedBaseline();
    write(
      "src/lib/thing.ts",
      [
        "export const chip = (type: string) => {",
        "  const t = type.toUpperCase();",
        "  return t;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("出口自身的实现（lib/upper-token.ts）不被 P60 计", () => {
    seedBaseline();
    write(
      "src/lib/upper-token.ts",
      "export const upperToken = (v: unknown) => typeof v === 'string' ? v.trim().toUpperCase() : '';\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P61：应用事件（规范 §16.2.4.65）─────────────────────────────── */

  it("自建 CustomEvent 直接阻断（规范 P61）", () => {
    seedBaseline();
    write(
      "src/components/studio/Thing.tsx",
      [
        "export const fire = () => {",
        "  window.dispatchEvent(",
        "    new CustomEvent('canvas:produce', { detail: { id: 'n1' } }),",
        "  );",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P61");
  });

  it("订阅带命名空间冒号的事件名也计入 P61", () => {
    seedBaseline();
    write(
      "src/components/studio/Thing.tsx",
      [
        "export const useIt = () => {",
        "  useEffect(() => {",
        "    window.addEventListener('comfyapp:canvas-store-changed', () => {});",
        "  }, []);",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P61");
  });

  it("走 app-events 出口的落点不再被 P61 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/Thing.tsx",
      [
        'import { emitAppEvent } from "~/lib/app-events";',
        "export const fire = () => emitAppEvent('canvas:produce', { id: 'n1', resultPath: '/a' });",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("DOM 原生事件（click / resize）不算 P61（没有命名空间冒号）", () => {
    /* 本条账只认「应用事件」—— `addEventListener('click')` 是 DOM 事件，
     * 换了出口也没地方换。 */
    seedBaseline();
    write(
      "src/components/studio/Thing.tsx",
      [
        "export const useIt = () => {",
        "  useEffect(() => {",
        "    window.addEventListener('click', () => {});",
        "  }, []);",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("出口自身的实现（lib/app-events.ts）不被 P61 计", () => {
    seedBaseline();
    write(
      "src/lib/app-events.ts",
      [
        "export const emitAppEvent = (name: string, detail?: unknown) => {",
        "  window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }));",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("src/config 也在扫描范围内（应用事件的派发侧在那里）", () => {
    /* `custom-nodes:updated` 的派发侧住在 `src/config/custom-nodes.ts` ——
     * 只扫前四条根会让这条事件的一半落在扫描面之外。 */
    seedBaseline();
    write(
      "src/config/thing.ts",
      "export const fire = (count: number) => window.dispatchEvent(new CustomEvent('custom-nodes:updated', { detail: { count } }));\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P61");
  });

  /* ── P62：事件值 → 值回调的改写样板（规范 §16.2.4.66）───────────── */

  it("自写 `e => setX(e.target.value)` 阻断（规范 P62）", () => {
    seedBaseline();
    write(
      "src/components/studio/P62Value.tsx",
      [
        "export const Thing = ({ q, setQ }: { q: string; setQ: (v: string) => void }) => (",
        "  <input value={q} onChange={(event) => setQ(event.target.value)} />",
        ");",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P62");
  });

  it("自写 `e => setX(e.target.checked)` 同样阻断（同一条账的另一半）", () => {
    seedBaseline();
    write(
      "src/components/studio/P62Checked.tsx",
      'export const Thing = ({ on }: { on: (v: boolean) => void }) => (\n  <input type="checkbox" onChange={(e) => on(e.target.checked)} />\n);\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P62");
  });

  it("走 form-props 出口的落点不再被 P62 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/P62Ok.tsx",
      [
        'import { checkedHandler, textHandler } from "~/lib/form-props";',
        /* 顺带 import ui/checkbox 让新加的 P69 判据短路——本 fixture 的
         * 原意是「checkedHandler 走 form-props 出口不被 P62 计」,与 P69
         * 无关;fixture 只跑 check-ui-primitives.cjs、不跑 eslint,未使用的
         * import 不会报警。 */
        'import { Checkbox } from "~/components/ui/checkbox";',
        "void Checkbox;",
        "export const Thing = ({ q, setQ, on }: { q: string; setQ: (v: string) => void; on: (v: boolean) => void }) => (",
        "  <>",
        "    <input value={q} onChange={textHandler(setQ)} />",
        '    <input type="checkbox" onChange={checkedHandler(on)} />',
        "  </>",
        ");",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("带语句体的 onChange 不算 P62（同一事件里还要做别的事）", () => {
    /* 判据太宽会逼人把那类多步逻辑塞进一个表达式去迎合它。取值仍应走
     * `readTextInput`，但判据够不着、也不该硬够。 */
    seedBaseline();
    write(
      "src/components/studio/P62Block.tsx",
      [
        "export const Thing = ({ setQ }: { setQ: (v: string) => void }) => (",
        "  <input",
        "    onChange={(event) => {",
        "      setQ(event.target.value);",
        "      event.target.style.height = 'auto';",
        "    }}",
        "  />",
        ");",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P63：分页 / 窗口切片（规范 §16.2.4.67）───────────────────────── */

  it("自写倒序分页的偏移算式阻断（规范 P63）", () => {
    seedBaseline();
    write(
      "src/components/studio/P63Offset.tsx",
      "export const after = (logs: number[], page: number, size: number) => Math.max(0, logs.length - page * size);\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P63");
  });

  it("自写总页数 / 总块数也计入 P63", () => {
    seedBaseline();
    write(
      "src/components/studio/P63Ceil.tsx",
      "export const pages = (all: string[], size: number) => Math.ceil(all.length / size);\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P63");
  });

  it("尾部窗口的 `.slice(-N)` 同样计入 P63", () => {
    seedBaseline();
    write(
      "src/components/studio/P63Tail.tsx",
      "export const tail = (logs: number[], size: number) => logs.slice(-size);\n",
    );
    const { code, output } = run();
    expect(code, output).toBe(1);
    expect(output).toContain("P63");
  });

  it("走 page-window 出口的落点不再被 P63 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/P63Ok.tsx",
      [
        'import { tailPages, tailWindow } from "~/lib/page-window";',
        "export const slice = (logs: number[], page: number, size: number) => (",
        "  tailPages(logs, page, size).entries.length + tailWindow(logs, size).length",
        ");",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("取短码的 `.slice(-4)` 不算 P63（不是尾部窗口）", () => {
    /* 判据太宽会把 `id.slice(-4)` / `.toString(36).slice(-4)` 这类「取短码」
     * 一并算上，而它们与「取列表尾部 N 条」不是同一件事。 */
    seedBaseline();
    write(
      "src/components/studio/P63Short.tsx",
      "export const short = (id: string) => `#${id.slice(-4)}`;\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("P63 自写分页");
    expect(output).not.toContain("studio/P63Short.tsx");
  });

  /* ── P64：进度回调节流（规范 §16.2.4.68）──────────────────────────── */

  it("把高频进度回调直接写进 state 阻断（规范 P64）", () => {
    seedBaseline();
    write(
      "src/components/studio/P64Raw.tsx",
      [
        "export const watch = (runTask: (h: { onProgress: (p: number) => void }) => void) => {",
        "  const [pct, setPct] = useState(0);",
        "  runTask({ onProgress: (p) => setPct(p) });",
        "  return pct;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P64");
  });

  it("走 use-throttled-progress 出口的落点不再被 P64 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/P64Ok.tsx",
      [
        'import { useThrottledProgressMap } from "~/components/ui/use-throttled-progress";',
        "export const watch = (runTask: (h: { onProgress: (p: number) => void }) => void) => {",
        "  const pct = useThrottledProgressMap();",
        "  runTask({ onProgress: (p) => pct.report('a', p) });",
        "  return pct.progress;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P65：异步动作的忙碌位（规范 §16.2.4.71）─────────────────────── */

  it("忙碌位复位写在成功路径上直接阻断（规范 P65）", () => {
    seedBaseline();
    write(
      "src/components/studio/P65Raw.tsx",
      [
        "export const useSave = () => {",
        "  const [saving, setSaving] = useState(false);",
        "  const run = async () => {",
        "    setSaving(true);",
        "    await save();",
        "    setSaving(false);",
        "  };",
        "  return { saving, run };",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(1);
    expect(output).toContain("P65");
  });

  it("复位写在 `finally` 里不算 P65（那形态本身是对的）", () => {
    seedBaseline();
    write(
      "src/components/studio/P65Ok.tsx",
      [
        "export const useSave = () => {",
        "  const [saving, setSaving] = useState(false);",
        "  const run = async () => {",
        "    setSaving(true);",
        "    try {",
        "      await save();",
        "    } finally {",
        "      setSaving(false);",
        "    }",
        "  };",
        "  return { saving, run };",
        "};",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("P65 ");
    expect(output).not.toContain("studio/P65Ok.tsx");
  });

  it("复位写在 `catch` 里同样放行（失败路径也有出口）", () => {
    seedBaseline();
    write(
      "src/components/studio/P65Catch.tsx",
      [
        "export const useSave = () => {",
        "  const [saving, setSaving] = useState(false);",
        "  const run = async () => {",
        "    setSaving(true);",
        "    try {",
        "      await save();",
        "    } catch (e) {",
        "      report(e);",
        "    } finally {",
        "      setSaving(false);",
        "    }",
        "  };",
        "  return { saving, run };",
        "};",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P65Catch.tsx");
  });

  it("走 use-busy-action 出口的落点不再被 P65 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/P65Export.tsx",
      [
        'import { useBusyAction } from "~/components/ui/use-busy-action";',
        "export const useSave = () => {",
        "  const busy = useBusyAction();",
        "  const run = () => busy.run(() => save());",
        "  return { busy: busy.busy, run };",
        "};",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P65Export.tsx");
  });

  it("**同步**的开关不算 P65（没有跨 await 的异步边界）", () => {
    seedBaseline();
    write(
      "src/components/studio/P65Sync.tsx",
      [
        "export const Toggle = () => {",
        "  const [on, setOn] = useState(false);",
        "  const turnOn = () => {",
        "    setOn(true);",
        "    setOn(false);",
        "  };",
        "  return { on, turnOn };",
        "};",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P65Sync.tsx");
  });

  /* ── P66：重入闸门（规范 §16.2.4.69）─────────────────────────────── */

  it("自建的重入闸门直接阻断（规范 P66）", () => {
    seedBaseline();
    write(
      "src/components/studio/P66Raw.tsx",
      [
        "export const useCopy = () => {",
        "  const pendingRef = useRef(false);",
        "  const copy = async () => {",
        "    if (pendingRef.current) return;",
        "    pendingRef.current = true;",
        "    try {",
        "      await write();",
        "    } finally {",
        "      pendingRef.current = false;",
        "    }",
        "  };",
        "  return copy;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output);
    expect(output).toContain("P66");
  });

  it("走 reentrancy-lock 出口的落点不再被 P66 计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/P66Ok.tsx",
      [
        'import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";',
        "export const useCopy = () => {",
        "  const lock = useReentrancyLock();",
        "  const copy = async () => {",
        "    if (!lock.tryEnter()) return;",
        "    try {",
        "      await write();",
        "    } finally {",
        "      lock.exit();",
        "    }",
        "  };",
        "  return copy;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P66Ok.tsx");
  });

  it("镜像 ref（只读不判重入）不算 P66", () => {
    seedBaseline();
    write(
      "src/components/studio/P66Mirror.tsx",
      [
        "export const useThing = (value: string) => {",
        "  const valueRef = useRef(value);",
        "  useEffect(() => {",
        "    valueRef.current = value;",
        "  }, [value]);",
        "  const read = () => valueRef.current;",
        "  return read;",
        "};",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P66Mirror.tsx");
  });

  it("出口自身的实现（components/ui/use-reentrancy-lock.ts）不被 P66 计", () => {
    seedBaseline();
    write(
      "src/components/ui/use-reentrancy-lock.ts",
      [
        "export function useReentrancyLock() {",
        "  const lockedRef = useRef(false);",
        "  const tryEnter = () => {",
        "    if (lockedRef.current) return false;",
        "    lockedRef.current = true;",
        "    return true;",
        "  };",
        "  return { tryEnter };",
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("components/ui/use-reentrancy-lock.ts");
  });

  it("`onProgress` 写在别处的普通 setter 不算 P64（判据认的是订阅回调）", () => {
    seedBaseline();
    write(
      "src/components/studio/P64Plain.tsx",
      [
        "export const useUpload = () => {",
        "  const [pct, setPct] = useState(0);",
        "  const start = async () => {",
        "    setPct(0);",
        "    await upload({ onUploaded: () => setPct(100) });",
        "  };",
        "  return { pct, start };",
        "};",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("P64 ");
    expect(output).not.toContain("studio/P64Plain.tsx");
  });

  it("lib 层的既有出口实现不被 P1~P38 误伤（只有逐条登记的判据扫 lib）", () => {
    /* 这是本批最容易踩的一脚：把 `src/lib` 直接加进扫描根，会让
     * `browser-io` / `dom-rect` / `file-io` 这些**出口自身的实现**被判违规
     *（它们本来就该做那件事）。试写一份「出口实现」的形态验一遍。 */
    seedBaseline();
    write(
      "src/lib/browser-io.ts",
      [
        "export async function copyText(text: string): Promise<boolean> {",
        "  await navigator.clipboard.writeText(text);",
        "  return true;",
        "}",
      ].join("\n"),
    );
    write(
      "src/lib/file-io.ts",
      [
        "export async function readFileAsText(file: File): Promise<string> {",
        "  return await file.text();",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("ui/ 基元自身实现放行（Button 里本来就是 <button>）", () => {
    write("src/components/ui/button.tsx", BUTTON_VIEW);
    seedBaseline();
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("0 处");
  });

  it("studio/** 的业务目录不放行（豁免目录已按 §16.2.4 归还）", () => {
    /* `studio/ui/**` 与 `studio/shared/**` 曾整体豁免（它们是「待合并的
       第二套 UI kit」）。归并完成后豁免必须撤掉 —— 再留一条按目录的模糊
       放行，等于让那两处的新增自实现在这里悄悄溜过。 */
    seedBaseline();
    write("src/components/studio/workflow-form/D.tsx", BUTTON_VIEW);
    write("src/components/studio/workflow-form/E.tsx", PORTAL_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("workflow-form/D.tsx");
    expect(output).toContain("workflow-form/E.tsx");
  });

  it("<feature>/hooks/ 放行（§16.2.1 第②层是逻辑层，不是视图）", () => {
    write("src/components/workshop/hooks/use-x.ts", SPIN_VIEW);
    seedBaseline();
    const { code } = run();
    expect(code).toBe(0);
  });

  it("测试文件放行（测试里的 DOM 与 mock 不算视图实现）", () => {
    write("src/components/workshop/A.test.tsx", BUTTON_VIEW);
    write("src/components/workshop/__tests__/B.tsx", PORTAL_VIEW);
    seedBaseline();
    const { code } = run();
    expect(code).toBe(0);
  });

  it("棘轮：已登记的存量放行，新增的仍阻断", () => {
    write("src/components/workshop/Known.tsx", BUTTON_VIEW);
    seedBaseline();
    expect(run().code).toBe(0);
    write("src/components/workshop/Fresh.tsx", BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/components/workshop/Fresh.tsx");
    expect(output).not.toContain("Known");
  });

  it("棘轮：同一文件处数上升也阻断（只许降不许升）", () => {
    write("src/components/studio/G.tsx", BUTTON_VIEW);
    seedBaseline();
    write("src/components/studio/G.tsx", BUTTON_VIEW + BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("上升");
  });

  it("--update 拒绝放宽基线（不得用 --update 掩盖新增）", () => {
    write("src/components/studio/H.tsx", BUTTON_VIEW);
    seedBaseline();
    write("src/components/studio/I.tsx", BUTTON_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("拒绝放宽基线");
  });

  it("治理后收紧：--strict 要求执行 --update，收紧后转绿", () => {
    write("src/components/studio/J.tsx", BUTTON_VIEW);
    seedBaseline();
    write("src/components/studio/J.tsx", "export const J = 1;\n");
    const strict = run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("--update");
    expect(run(["--update"]).code).toBe(0);
    expect(run(["--strict"]).code).toBe(0);
  });

  it("--report 只盘点不判失败", () => {
    write("src/components/studio/K.tsx", BUTTON_VIEW + SPIN_VIEW);
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("P1");
    expect(output).toContain("P3");
  });

  it("基线文件缺失时给可行动提示而不是静默通过", () => {
    write("src/components/studio/L.tsx", BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("--update");
  });

  /* ── 注释里的 `<button>` 是说明，不是实现 ────────────────────────────────
   * 判据先剥注释：把一处手写按钮改成 `<Button>` 并顺手把理由（「原来是
   * `<button>` 手搓」）写进注释，是最自然不过的写法 —— 若不剥注释，该文件
   * 的计数会停在原地，棘轮永远降不下去，而代码其实已经合规。
   * 同款教训见 `check-theme-colors.cjs`（注释里的 `#346` 被误判成色值）。 */
  it("注释里提到 <button> 不计入 P1", () => {
    write(
      "src/components/studio/N.tsx",
      "/* 原来是 <button> 手搓，现改走 <Button>（ISSUE #672） */\n" +
        "// 也见 <button> 的默认 type\n" +
        "export const N = () => <Button>ok</Button>;\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/N.tsx");
  });

  it("代码里（含字符串字面量）的 <button> 仍然计入 P1", () => {
    write(
      "src/components/studio/O.tsx",
      'export const O = () => <button type="button">ok</button>;\n',
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("studio/O.tsx");
  });

  it("块注释跨多行时不会漏剥（<button> 落在中间那行）", () => {
    write(
      "src/components/studio/P.tsx",
      "/*\n * 说明：\n * 这里渲染一个 <button\n * 但现在走基元\n */\nexport const P = 1;\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P.tsx");
  });

  it("写入的基线带 rules 说明与 total（清单不自证失效）", () => {
    write("src/components/studio/M.tsx", BUTTON_VIEW);
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { total: number; rules: Record<string, string> };
    expect(baseline.total).toBe(1);
    expect(baseline.rules.P1).toBeTruthy();
    expect(baseline.rules.P2).toBeTruthy();
    expect(baseline.rules.P3).toBeTruthy();
  });

  /* ── P67：ui/ 层自造组件绕开 shadcn 基元（§16.2.3 / §12.18）────────
   * 与 P1~P66 的"视图层不自造原语"对偶：这一条守的是 ui/ 层自己有没有
   * 基于 shadcn 已装基元二次封装。范围收窄到 ui/ 是因为视图层的
   * `WorkflowPickChip` / `ShotStatusBadge` 等业务包装消费 ui/ 基元后
   * 用同样的命名不算轮子（见脚本内 UI_ONLY_RULES 的注释）。
   * Empty / Field 基元当前未装，命中数即棘轮起点，装上并二次封装后
   * 自动清零。 */

  it("P67 a. Badge 绕开：ui/ 里 `export function X(Badge|Chip|Tag)` 未 import Badge → 阻断", () => {
    seedBaseline();
    write(
      "src/components/ui/P67Badge.tsx",
      [
        'import { cn } from "~/lib/utils";',
        "export function MyFancyBadge({ children }: { children: React.ReactNode }) {",
        "  return <span className={cn('inline-flex items-center rounded-full text-xs', className)}>{children}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P67");
    expect(output).toContain("ui/P67Badge.tsx");
  });

  it("P67 a. 已 import Badge 的二次封装 → 合规者不误伤", () => {
    seedBaseline();
    write(
      "src/components/ui/P67BadgeOk.tsx",
      [
        'import { Badge } from "~/components/ui/badge";',
        "export function MyFancyBadge({ children }: { children: React.ReactNode }) {",
        '  return <Badge variant="secondary">{children}</Badge>;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("ui/P67BadgeOk.tsx");
  });

  it("P67 a. shadcn 基元内部的 `function XBadge`（非 export）不算轮子", () => {
    /* 复刻 shadcn avatar.tsx / combobox.tsx 内部 `function AvatarBadge` /
     * `function ComboboxChip` 的形态：不写 `export function`，而是内部
     * `function Foo` + 文件末尾 `export { ..., Foo }` 聚合导出。
     * 判据以 `export function` 为锚点即可精准避开——不用逐个基元走
     * EXEMPT_FILES。 */
    seedBaseline();
    write(
      "src/components/ui/P67ShadcnInner.tsx",
      [
        "function InternalBadge({ children }: { children: React.ReactNode }) {",
        "  return <span>{children}</span>;",
        "}",
        "export function Root() {",
        "  return <span>root</span>;",
        "}",
        "export { InternalBadge };",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("ui/P67ShadcnInner.tsx");
  });

  it('P67 b. Progress 绕开：ui/ 里手写 `role="progressbar"` 未 import Progress → 阻断', () => {
    seedBaseline();
    write(
      "src/components/ui/P67Progress.tsx",
      [
        'import { cn } from "~/lib/utils";',
        "export function MyProgress({ value }: { value: number }) {",
        "  return (",
        '    <div role="progressbar" aria-valuenow={value} className={cn("h-1 w-full")}>',
        "      <div style={{ width: `${value}%` }} />",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P67");
    expect(output).toContain("ui/P67Progress.tsx");
  });

  it("P67 b. 已 import Progress 的二次封装 → 合规者不误伤", () => {
    seedBaseline();
    write(
      "src/components/ui/P67ProgressOk.tsx",
      [
        'import { Progress } from "~/components/ui/progress";',
        "export function MyProgress({ value }: { value: number }) {",
        "  return <Progress value={value} />;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("ui/P67ProgressOk.tsx");
  });

  it('P67 c. Slider 绕开：ui/ 里原生 `<input type="range">` 未 import Slider → 阻断', () => {
    seedBaseline();
    write(
      "src/components/ui/P67Slider.tsx",
      [
        "export function MySlider({ v, on }: { v: number; on: (n: number) => void }) {",
        "  return (",
        '    <input type="range" min={0} max={100} value={v} onChange={(e) => on(+e.target.value)} />',
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P67");
    expect(output).toContain("ui/P67Slider.tsx");
  });

  it("P67 d. Empty 绕开：ui/ 里 `export function EmptyState` 未 import Empty → 阻断", () => {
    seedBaseline();
    write(
      "src/components/ui/P67Empty.tsx",
      [
        "export function EmptyCustom() {",
        '  return <div className="border-dashed">空</div>;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P67");
    expect(output).toContain("ui/P67Empty.tsx");
  });

  it("P67 e. Field 绕开：ui/ 里手拼 `<label htmlFor>` + JS 对象键 `aria-describedby` → 阻断", () => {
    /* 与 form-field.tsx 的实际写法对齐：a11y 通过 `{ "aria-describedby": id }`
     * 对象透传，不是 JSX 属性 aria-describedby="…"。判据必须吃这一形态，
     * 否则真轮子会漏检。 */
    seedBaseline();
    write(
      "src/components/ui/P67Field.tsx",
      [
        "export function MyFormField({ id, err }: { id: string; err?: string }) {",
        "  const a11y = {",
        "    id,",
        '    ...(err ? { "aria-describedby": `${id}-err` } : {}),',
        "  };",
        "  return (",
        "    <div>",
        "      <label htmlFor={id}>标签</label>",
        "      <input {...a11y} />",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P67");
    expect(output).toContain("ui/P67Field.tsx");
  });

  it("P67 e. shadcn form.tsx 用 `<Label htmlFor>` 大写组件（非 `<label>`）→ 不误伤", () => {
    seedBaseline();
    write(
      "src/components/ui/P67FormOk.tsx",
      [
        'import { Label } from "~/components/ui/label";',
        "export function FormLabelShadcn({ id }: { id: string }) {",
        '  const a11y = { "aria-describedby": `${id}-desc` };',
        "  return (",
        "    <div>",
        "      <Label htmlFor={id}>标签</Label>",
        "      <input {...a11y} />",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("ui/P67FormOk.tsx");
  });

  it("P67 范围收窄：视图层里同样命名的业务包装不算轮子（UI_ONLY 短路生效）", () => {
    /* UI_ONLY_RULES 的意义：P67 只在 ui/ 层跑，视图层同样的命名形态
     * 是消费基元的业务包装、不该被算进本条账。少了这层收窄，
     * WorkflowPickChip / ShotStatusBadge 等一片会被误伤。
     * **刻意不 import Badge**——否则 sub-signal 内部的 import 短路自己
     * 就命中合规分支，测不到范围收窄本身。 */
    seedBaseline();
    write(
      "src/components/studio/P67ViewChip.tsx",
      [
        "export function FeatureStatusChip({ tone }: { tone: string }) {",
        "  return <span className={`chip-${tone}`}>feature</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P67ViewChip.tsx");
  });

  it("P67 基线冻结 8 处，再新增一处 ui/ 轮子 → 阻断（棘轮只许降）", () => {
    /* 直接跑（不带 --report / --update），main 会把新命中当"新增 P67"
     * 报出来并阻断——这是治理前 P67 起点已经在真仓库锁死的直接体现。 */
    seedBaseline();
    write(
      "src/components/ui/P67Sneak.tsx",
      "export function SneakyBadge() { return <span>b</span>; }\n",
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P67");
    expect(output).toContain("ui/P67Sneak.tsx");
  });

  /* ── P68/P69：视图层 raw <input> / <textarea> / <input type=checkbox|radio>
   * 判据（§16.2.3 / §12.18 · settings/ 目录 9 处治理之后加，冻结剩余视图层
   * 落点为棘轮起点）。P67 是 ui/ 层判据（UI_ONLY_RULES），P68/P69 是视图层
   * 判据（默认作用域：view + app + server；ui/、hooks/、lib/ 走原有 EXEMPT_DIRS
   * 短路）。 */

  it("P68 视图层手写 <input type=text> 阻断（规范 P68）", () => {
    seedBaseline();
    write(
      "src/components/studio/P68RawInput.tsx",
      [
        "export function SearchBox() {",
        '  return <input type="text" placeholder="搜" />;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P68");
    expect(output).toContain("studio/P68RawInput.tsx");
  });

  it("P68 视图层手写 <textarea> 同样阻断", () => {
    seedBaseline();
    write(
      "src/components/studio/P68RawTextarea.tsx",
      [
        "export function NotesBox() {",
        "  return <textarea rows={4} />;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P68");
    expect(output).toContain("studio/P68RawTextarea.tsx");
  });

  it("P68 已 import ui/input 的落点不再被计（合规者不误伤）", () => {
    seedBaseline();
    write(
      "src/components/studio/P68OkInput.tsx",
      [
        'import { Input } from "~/components/ui/input";',
        "export function SearchBox() {",
        '  return <Input type="text" placeholder="搜" />;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P68OkInput.tsx");
  });

  it("P68 ui/ 基元自身实现放行（`ui/file-picker.tsx` 里的 <input type=file> 不算视图轮子）", () => {
    /* ui/ 层默认被 EXEMPT_DIRS 豁免（P68 不在 UI_ALSO_SCANNED 也不在
     * UI_ONLY_RULES），基元自身的 raw input 不该被算进视图层账。 */
    seedBaseline();
    write(
      "src/components/ui/P68PrimitiveFilePicker.tsx",
      [
        'import { cn } from "~/lib/utils";',
        "export function MyFilePicker() {",
        '  return <input type="file" className={cn("hidden")} />;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("ui/P68PrimitiveFilePicker.tsx");
  });

  it("P69 视图层手写 <input type=checkbox> 阻断（规范 P69）", () => {
    seedBaseline();
    write(
      "src/components/studio/P69RawCheckbox.tsx",
      [
        "export function Toggle() {",
        '  return <input id="x" type="checkbox" />;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P69");
    expect(output).toContain("studio/P69RawCheckbox.tsx");
  });

  it("P71 视图层手写 dark:palette 色计入棘轮（规范 §4.11.1 / P71）", () => {
    seedBaseline();
    write(
      "src/components/studio/P71DarkPalette.tsx",
      [
        "export function V() {",
        '  return <span className="text-red-700 dark:text-red-400">x</span>;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P71");
    expect(output).toContain("studio/P71DarkPalette.tsx");
  });

  it("P71 语义 token（含 dark: 但不带 palette 色名）不误伤", () => {
    seedBaseline();
    write(
      "src/components/studio/P71Semantic.tsx",
      [
        "export function V() {",
        '  return <span className="text-ink-muted dark:text-ink-bright">x</span>;',
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P71 只计 p71-allow 块外的 dark:palette（§3.6.1 ANSI 例外靠标记生效）", () => {
    seedBaseline();
    write(
      "src/components/studio/P71Allow.tsx",
      [
        "const ANSI = {",
        "  // p71-allow:start ANSI SGR 终端色是 §3.6.1 例外",
        '  inside: "text-red-700 dark:text-red-400",',
        "  // p71-allow:end",
        '  outside: "text-rose-700 dark:text-rose-400",',
        "};",
        "export function V() {",
        "  return <span>{ANSI.inside}{ANSI.outside}</span>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run(["--update"]);
    expect(code, output).toBe(0);
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { files: Record<string, { P71?: number }> };
    // 块外那一处计入、块内那一处被 allow 标记剥掉 → 恰好 1，而不是 2。
    expect(baseline.files["src/components/studio/P71Allow.tsx"]?.P71).toBe(1);
  });

  /* ── P72「模态无可访问名」（硬闸）差分回归 ─────────────────────────
   * 见 scripts/check-ui-primitives.cjs 里 P72 注释与规范 §16.2.3 /
   * shadcn composition.md「Dialog/Sheet always need a Title」。
   * 判据按标签块扫 `<DialogContent>` / `<SheetContent>`，块内既无
   * 对应 Title 组件又无 aria-label/aria-labelledby 即计 1。 */
  it("P72 DialogContent 无 Title/aria-label → 阻断", () => {
    seedBaseline();
    write(
      "src/components/studio/P72BareDialog.tsx",
      [
        "import { Dialog, DialogContent } from '~/components/ui/dialog';",
        "export function V() {",
        "  return (",
        "    <Dialog open>",
        "      <DialogContent>",
        "        <h2>模型适配器</h2>",
        "      </DialogContent>",
        "    </Dialog>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P72");
    expect(output).toContain("studio/P72BareDialog.tsx");
  });

  it("P72 SheetContent 无 SheetTitle/aria-label → 阻断", () => {
    seedBaseline();
    write(
      "src/components/studio/P72BareSheet.tsx",
      [
        "import { Sheet, SheetContent } from '~/components/ui/sheet';",
        "export function V() {",
        "  return (",
        "    <Sheet open>",
        "      <SheetContent side='right'>",
        "        <div>面板</div>",
        "      </SheetContent>",
        "    </Sheet>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P72");
    expect(output).toContain("studio/P72BareSheet.tsx");
  });

  it("P72 有 DialogTitle 放行（可以是 sr-only）", () => {
    seedBaseline();
    write(
      "src/components/studio/P72WithDialogTitle.tsx",
      [
        "import { Dialog, DialogContent, DialogTitle } from '~/components/ui/dialog';",
        "export function V() {",
        "  return (",
        "    <Dialog open>",
        "      <DialogContent>",
        "        <DialogTitle className='sr-only'>模型适配器</DialogTitle>",
        "        <h2 aria-hidden>模型适配器</h2>",
        "      </DialogContent>",
        "    </Dialog>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P72 有 aria-label 放行（本仓库自绘 header 的主用写法）", () => {
    seedBaseline();
    write(
      "src/components/studio/P72WithAriaLabel.tsx",
      [
        "import { Dialog, DialogContent } from '~/components/ui/dialog';",
        "export function V() {",
        "  return (",
        "    <Dialog open>",
        "      <DialogContent aria-label='模型选择'>",
        "        <h3 className='u-title'>模型选择</h3>",
        "      </DialogContent>",
        "    </Dialog>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P72 有 aria-labelledby 放行（confirm-dialog 类内联 titleId 的写法）", () => {
    seedBaseline();
    write(
      "src/components/studio/P72WithLabelledBy.tsx",
      [
        "import { Dialog, DialogContent } from '~/components/ui/dialog';",
        "export function V({ titleId }: { titleId: string }) {",
        "  return (",
        "    <Dialog open>",
        "      <DialogContent aria-labelledby={titleId}>",
        "        <h2 id={titleId}>确认</h2>",
        "      </DialogContent>",
        "    </Dialog>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P72 一个文件里多个 DialogContent 各计一次（多模态叠加要逐个补 aria）", () => {
    seedBaseline();
    write(
      "src/components/studio/P72Multi.tsx",
      [
        "import { Dialog, DialogContent } from '~/components/ui/dialog';",
        "export function V() {",
        "  return (",
        "    <>",
        "      <Dialog open><DialogContent><div>a</div></DialogContent></Dialog>",
        "      <Dialog open><DialogContent aria-label='ok'><div>b</div></DialogContent></Dialog>",
        "      <Dialog open><DialogContent><div>c</div></DialogContent></Dialog>",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    );
    /* P72 是硬闸：`--update` 会被「未清零」直接拒绝（这是判据应有的表现，
     * 别拿它当"冻结现状"的通道）。这里只用严格 run() 断言：
     * ① 阻断；② 输出里点名这一文件；③ 计到 2 处（同文件两段各计一次）。 */
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P72");
    expect(output).toContain("studio/P72Multi.tsx");
    expect(output).toMatch(/P72[^\n]*2\s*处|P72Multi\.tsx（2\s*处）/);
  });

  /* ── P76「视图层裸写 <select>」（棘轮）差分回归 ────────────────
   * 见 scripts/check-ui-primitives.cjs 里 P76 注释：P68 拦住了裸
   * `<input>` / `<textarea>`、P69 拦住了裸 checkbox/radio；`<select>` 是同族
   * 漏项。合规出口有两个（`ui/native-select` 的 `<NativeSelect>` 或
   * `ui/select-menu` 的 `<SelectMenu>`），本判据只按形态数、不管选哪个。 */
  it("P76 视图层裸 <select> 计入棘轮（相对基线增量 → 阻断）", () => {
    seedBaseline();
    write(
      "src/components/studio/P76RawSelect.tsx",
      [
        "export function V() {",
        "  return (",
        "    <select defaultValue='a'>",
        "      <option value='a'>A</option>",
        "    </select>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P76");
    expect(output).toContain("studio/P76RawSelect.tsx");
  });

  it("P76 `ui/native-select.tsx` 是这条账要收口的唯一出口，走 EXEMPT_DIRS 天然豁免", () => {
    seedBaseline();
    write(
      "src/components/ui/native-select.tsx",
      [
        "export function NativeSelect() {",
        "  return <select data-slot='native-select' />;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P76 不误伤同前缀标识符与类名（selectedValue / select-none / onSelect 等）", () => {
    seedBaseline();
    write(
      "src/components/studio/P76FalsePositive.tsx",
      [
        "export function V({ selectedValue, onSelect }: { selectedValue: string; onSelect: (s: string) => void }) {",
        "  return <div className='select-none' data-value={selectedValue} onClick={() => onSelect('x')}>x</div>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P78「视图层裸写 <label>」（棘轮）差分回归 ────────────────
   * 见 scripts/check-ui-primitives.cjs 里 P78 注释：与 P23 是同一族账的两层
   * （P23 数表单行组合形态、已清零；P78 数任意 <label 起始标签、含无控件的
   * 孤立 label）。合规出口：FormField / FieldLabel / Base UI Checkbox 的
   * children。锚点 `<label[\s/>]`，不误伤 labelClassName / label= 同前缀。 */
  it("P78 视图层裸 <label> 计入棘轮（相对基线增量 → 阻断）", () => {
    seedBaseline();
    write(
      "src/components/studio/P78RawLabel.tsx",
      [
        "export function V() {",
        "  return <label className='text-xs'>名称</label>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).not.toBe(0);
    expect(output).toContain("P78");
    expect(output).toContain("studio/P78RawLabel.tsx");
  });

  it("P78 ui/label.tsx 与 ui/field.tsx 是这条账要收口的出口，走 EXEMPT_DIRS 天然豁免", () => {
    seedBaseline();
    write(
      "src/components/ui/label.tsx",
      [
        "export function Label() {",
        "  return <label htmlFor='x'>ok</label>;",
        "}",
      ].join("\n"),
    );
    write(
      "src/components/ui/field.tsx",
      [
        "export function FieldLabel() {",
        "  return <label htmlFor='y'>ok</label>;",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  it("P78 不误伤同前缀属性名（labelClassName / label='x' / <labeling），只数 <label 起始标签", () => {
    seedBaseline();
    write(
      "src/components/studio/P78FalsePositive.tsx",
      [
        "export function V({ labelClassName }: { labelClassName: string }) {",
        "  return (",
        "    <div",
        "      label='text'",
        "      data-hint='<labeling not real tag'",
        "    >",
        "      <span className={labelClassName}>ok</span>",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, output } = run();
    expect(code, output).toBe(0);
  });

  /* ── P78 引入顺带解锁的 --update 逻辑：判据引入 vs 已有规则上升 ─────
   * 见 scripts/check-ui-primitives.cjs 里 `before && after > before` 的
   * 分支重构。测试锁：
   *   · 旧基线里从没出现过的 rule id（新加判据的起点登记）→ `--update` 允许；
   *   · 旧基线里已经有过的 rule id 上升 → `--update` 必须拒绝。
   * 步骤：先造一个 P78 现场 → `--update` 登记起点 → 再写第二个 P78 →
   * 第二次 `--update` 必须拦下（P78 已在基线、从 1 涨到 2 是"已有 rule 上升"）。 */
  it("--update 允许登记新判据起点、但拦下已有 rule id 的上升", () => {
    write(
      "src/components/studio/P78Seed.tsx",
      [
        "export function V() {",
        "  return <label className='text-xs'>seed</label>;",
        "}",
      ].join("\n"),
    );
    /* 第一次 --update：P78 从未在旧基线出现过、这是判据引入的起点登记，
     * 允许通过。 */
    const { code: firstCode, output: firstOut } = run(["--update"]);
    expect(firstCode, firstOut).toBe(0);
    /* 再写一个 P78 文件：after=2，基线里的 P78=1 已存在，此时上升就是"已有
     * rule 上升"、必须拒绝。 */
    write(
      "src/components/studio/P78Regress.tsx",
      [
        "export function V() {",
        "  return <label className='text-xs'>regress</label>;",
        "}",
      ].join("\n"),
    );
    const { code: secondCode, output: secondOut } = run(["--update"]);
    expect(secondCode, secondOut).not.toBe(0);
    expect(secondOut).toContain("拒绝放宽基线");
    expect(secondOut).toContain("P78：1 → 2");
  });
});

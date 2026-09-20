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
      'import { FormField } from "~/components/ui/form-field";\nexport function F({ v, on }: { v: string; on: (s: string) => void }) {\n  return (\n    <FormField label="名称" id="n">\n      {(a11y) => <input {...a11y} value={v} onChange={(e) => on(e.target.value)} />}\n    </FormField>\n  );\n}\n',
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

  it("role=tab 上复刻按钮默认行为不被 P26 计（那是 Button 的账）", () => {
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
    expect(code, output).toBe(0);
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
});

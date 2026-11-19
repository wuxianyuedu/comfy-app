/**
 * 外观偏好（圆角 / 标题字阶 / 字体）—— 令牌的唯一应用点与持久化形状。
 *
 * 为什么是顶层单例而不是某个页面的局部逻辑：这些档改的是**全局 CSS 变量**
 * （`--radius` / `--font-scale` / `--font-sans` / `--font-code` / `--font-mono`），
 * 必须在任何路由下都成立。若只在设置页里 setProperty，用户离开设置页、或刷新到
 * 别的路由，偏好就悄悄不生效了 —— 表现是"设置有时管用有时不管用"，这类半生效
 * 比没做更难查。
 *
 * 令牌形状（都在 `app/globals.css`，本模块不重复定义数值基准）：
 *   · `--radius` 是圆角总闸，`--radius-sm…4xl` 全部由它 calc 派生；
 *   · `--font-scale` 只作用于四档**标题**令牌，正文与小号文字不随它变
 *     （正文主力是 `text-sm`/14px，微标签 `text-2xs`/`text-3xs`）。这里曾写
 *     「正文锚定 13px」并被设置页当承诺展示给用户，实测 body 是 preflight 的
 *     16px、全站并无 13px 基准 —— 界面文案不要再写具体 px，写「保持原尺寸」。
 *   · 三档字体（`--font-sans` 界面 / `--font-code` 代码块 / `--font-mono` 终端）
 *     按部分各配**一种字体**（ISSUE #3784 与补充意见：西文/等宽首选、中文字体
 *     各一槽，系统回退固定），写进 CSS 变量的栈 = 各槽按序拼成；默认值就是
 *     `globals.css` 里那三颗的原值（逐字相同），因此「从没设过」与「设了默认」
 *     渲染完全一致；非法的空串只回落该档、不连坐圆角与字阶。槽位的分组与
 *     拼栈实现在设置页的 `appearance-font-helpers.ts`（纯展示侧拆解）。
 *
 * 刻意**没有**「界面密度」这一档：仓库里没有全局密度令牌（唯一的 `DENSITY_CLASS`
 * 是画布编辑器内部的局部常量）。做一个只影响半屏的假开关，比不做更糟。
 */
import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";

/** 持久化键。 */
export const APPEARANCE_STORAGE_KEY = "comfyapp:appearance-v1";

/** 一档可选值：id 用于持久化，label 是界面文案，value 是写进 CSS 变量的值。 */
export type AppearanceStep = {
  id: string;
  label: string;
  value: string;
};

/**
 * 圆角档位。`中` 就是 `globals.css` 里 `--radius` 那颗基数（1rem）——
 * 默认档必须与"从没设置过"逐像素相同，否则升级后老用户第一眼看到的就是变化。
 *
 * 标签里的 px 是**基数** `--radius`（= `--radius-lg`）：整条刻度按系数跟着它缩放
 * （`ui/card` 走 `rounded-xl`，实际角比标签值大 4px）。改基数或改这里的值，
 * 两边必须同批 —— 文案说 16px 而实渲染 12px 就是骗用户。
 */
export const RADIUS_STEPS: Array<AppearanceStep> = [
  { id: "sm", label: "小 · 12px", value: "0.75rem" },
  { id: "md", label: "中 · 16px", value: "1rem" },
  { id: "lg", label: "大 · 20px", value: "1.25rem" },
  { id: "xl", label: "特大 · 24px", value: "1.5rem" },
];

/** 标题字阶档位（倍率；基准在 CSS 里）。 */
export const FONT_SCALE_STEPS: Array<AppearanceStep> = [
  { id: "90", label: "紧凑 90%", value: "0.9" },
  { id: "100", label: "标准 100%", value: "1" },
  { id: "110", label: "舒适 110%", value: "1.1" },
  { id: "125", label: "宽松 125%", value: "1.25" },
];

/**
 * 三档字体的默认栈。**逐字**等于 `globals.css` 里对应的 `@theme` 声明：运行时
 * 这份默认值会被写回 `<html>` 上的同名变量，若与源码那串不一致，「设了默认」就会
 * 和「从没设过」渲染出两套字体。改一处必须两处同批。
 *
 * 它们是**自由字符串**：用户可在设置面板填任意字体栈（如 `Inter`、`IBM Plex Mono`），
 * 不必局限于已知档位 —— 这也意味着这里只校验「非空」，不校验「认不认得」。
 */
export const DEFAULT_INTERFACE_FONT =
  'var(--font-geist-sans), "Sarasa UI SC", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif';
export const DEFAULT_CODE_FONT = 'ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace';
export const DEFAULT_TERMINAL_FONT =
  '"SF Mono", ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, "Sarasa Mono SC", monospace';

export type AppearancePrefs = {
  /** 代码块字体栈（映射到 `--font-code`，`.cb-code-block` 等代码展示用）。 */
  codeFont: string;
  fontScale: string;
  /** 界面字体栈（映射到 `--font-sans`，覆盖全站正文与界面文字）。 */
  interfaceFont: string;
  radius: string;
  /** 终端字体栈（映射到 `--font-mono`，终端与等宽展示用）。 */
  terminalFont: string;
};

/** 默认值 = `globals.css` 里 `--radius` / `--font-scale` 的基数（两者必须同批改）。 */
export const DEFAULT_APPEARANCE: AppearancePrefs = {
  radius: "md",
  fontScale: "100",
  interfaceFont: DEFAULT_INTERFACE_FONT,
  codeFont: DEFAULT_CODE_FONT,
  terminalFont: DEFAULT_TERMINAL_FONT,
};

function stepValue(steps: Array<AppearanceStep>, id: string, fallbackId: string): string {
  const hit = steps.find((step) => step.id === id);
  return (hit ?? steps.find((step) => step.id === fallbackId))?.value ?? "";
}

/**
 * 解析持久化值。**任何不认识的取值都整份回落默认**，不做"认哪个用哪个"：
 * 半份生效会让界面出现"圆角是新的、字号是旧的"这种无法解释的组合。
 */
export function parseAppearance(raw: string | null | undefined): AppearancePrefs {
  if (raw === null || raw === undefined || raw === "") {
    return { ...DEFAULT_APPEARANCE };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_APPEARANCE };
  }
  /* SAFETY: 类型断言已复核 */
  const record = parsed as {
    codeFont?: unknown;
    fontScale?: unknown;
    interfaceFont?: unknown;
    radius?: unknown;
    terminalFont?: unknown;
  };
  /* 圆角 / 字阶是预置档位，仍是「任一非法整份回落」（不许圆角新的、字号旧的那种
     无法解释的组合）。字体三档是自由字符串，缺省或非法只回落该档、不连坐上面两档。 */
  if (
    typeof record.radius !== "string" ||
    typeof record.fontScale !== "string" ||
    !RADIUS_STEPS.some((step) => step.id === record.radius) ||
    !FONT_SCALE_STEPS.some((step) => step.id === record.fontScale)
  ) {
    return { ...DEFAULT_APPEARANCE };
  }
  const fontField = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value : fallback;
  return {
    radius: record.radius,
    fontScale: record.fontScale,
    interfaceFont: fontField(record.interfaceFont, DEFAULT_INTERFACE_FONT),
    codeFont: fontField(record.codeFont, DEFAULT_CODE_FONT),
    terminalFont: fontField(record.terminalFont, DEFAULT_TERMINAL_FONT),
  };
}

export function serializeAppearance(prefs: AppearancePrefs): string {
  return JSON.stringify(prefs);
}

/** 本偏好要写进 CSS 的变量集合（纯数据，便于单测）。 */
export function appearanceVars(prefs: AppearancePrefs): Record<string, string> {
  return {
    "--radius": stepValue(RADIUS_STEPS, prefs.radius, DEFAULT_APPEARANCE.radius),
    "--font-scale": stepValue(FONT_SCALE_STEPS, prefs.fontScale, DEFAULT_APPEARANCE.fontScale),
    /* 三档字体：直接把用户字体栈写进同名 CSS 变量，覆盖 globals.css 的默认值。
       默认值与源码逐字相同，因此「没设过」与「设了默认」渲染一致。 */
    "--font-sans": prefs.interfaceFont,
    "--font-code": prefs.codeFont,
    "--font-mono": prefs.terminalFont,
  };
}

/** 把变量写到给定元素上（默认 `<html>`，与 next-themes 的 `dark` class 同一层）。 */
export function applyAppearance(
  prefs: AppearancePrefs,
  element:
    | { style: { setProperty: (name: string, value: string) => void } }
    | null
    | undefined = typeof document === "undefined" ? null : document.documentElement,
): void {
  if (!element) {
    return;
  }
  for (const [name, value] of Object.entries(appearanceVars(prefs))) {
    element.style.setProperty(name, value);
  }
}

/** 读取已保存的偏好（无存储 / 坏值都回落默认）。 */
export function readAppearance(): AppearancePrefs {
  return parseAppearance(readStorageItem(APPEARANCE_STORAGE_KEY));
}

/**
 * 保存并立即生效。
 *
 * 返回是否写进了存储 —— 隐私模式等场景 `localStorage` 会抛，此时**变量仍然生效**
 * （本次会话可用），只是下次打开回到默认。界面要把这件事说出来，不能让用户以为
 * 设置丢了。
 */
export function saveAppearance(prefs: AppearancePrefs): boolean {
  applyAppearance(prefs);
  return writeStorageItem(APPEARANCE_STORAGE_KEY, serializeAppearance(prefs));
}

/**
 * 运行时用户字体加载器（#3513 第二部分）：把用户**拖入 / 选择的字体文件**经
 * `FontFace` API 注册进当前文档，并以二进制形式持久化到 IndexedDB，使换上的字体
 * 跨刷新 / 重启仍在。纯 Web API，浏览器与 Tauri WebView 同款，不依赖任何 Rust / FS
 * 插件 —— 字体文件**不进仓库**，那是发布产物的用户侧替换入口（设置页的设计口径）。
 *
 * 分工：本模块只负责「让某个 family 名真的能解析出字形」（注册 + 留存），而
 * 「某一档用哪个 family」仍由 `AppearancePrefs` 那三个自由字符串字段说了算 ——
 * 拖入后把 family 名写回对应档的文本框，沿用已有的变量落点。文本框是 family 名的
 * 来源，`restoreUserFonts` 在启动时把二进制重新喂给同名 family，于是「名在、字形也在」。
 *
 * 为什么是 IndexedDB 而不是 localStorage：字体二进制动辄数 MB（CJK woff2 单档
 * 8MB 上下），localStorage 的 5MB 硬上限装不下；IndexedDB 原生存 Blob、配额宽裕，
 * 且 WebView 的数据目录随应用留存，正好对应「成品给用户替换用的」。
 */

/** 三档字体的档位标识，决定 family 写回哪一档与回退族。 */
export type FontTier = "code" | "interface" | "terminal";

/** 持久化到 IndexedDB 的一条用户字体记录（字段按字母序，零规则 `sort-object-types`）。 */
export type UserFontRecord = {
  blob: Blob;
  family: string;
  fileName: string;
  format: string;
};

const FONT_DB_NAME = "comfyapp-user-fonts";
const FONT_STORE = "fonts";

/** 文件扩展名 → `@font-face` 的 format 提示（不写也能解析，只是更准）。 */
function formatForFile(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".otf")) {
    return "opentype";
  }
  if (lower.endsWith(".ttf")) {
    return "truetype";
  }
  if (lower.endsWith(".woff")) {
    return "woff";
  }
  if (lower.endsWith(".woff2")) {
    return "woff2";
  }
  return "truetype";
}

/** 由文件名派生一个稳定 family 名：去扩展名、清掉会破坏 CSS 引号字符串的字符。
 *  同名文件重拖 = 幂等覆盖；没有可读名字时兜底为 `Custom Font`。 */
function familyFromFileName(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replaceAll(/["\\]/g, "")
    .trim();
  return base.length > 0 ? base : "Custom Font";
}

/** 把 family 包成带合理回退的字体栈，写回对应档的文本框。含空格 / 非 ASCII 的
 *  family 名必须加引号，否则 CSS 把空格当分隔符解析断句。 */
export function fontStackForFamily(family: string, tier: FontTier): string {
  const needsQuote = /\s/.test(family) || /[^A-Za-z0-9_ -]/.test(family);
  const quoted = needsQuote ? `"${family}"` : family;
  const fallback = tier === "interface" ? "sans-serif" : "monospace";
  return `${quoted}, ${fallback}`;
}

/** 打开用户字体库（首次访问时建表，按 family 作主键）。非浏览器 / 无 IndexedDB
 *  时调用方已提前返回，这里不再判。 */
function openFontDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FONT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FONT_STORE)) {
        db.createObjectStore(FONT_STORE, { keyPath: "family" });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error(request.error?.message ?? "打开用户字体库失败"));
    };
  });
}

function putUserFont(record: UserFontRecord): Promise<void> {
  return openFontDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(FONT_STORE, "readwrite");
        tx.objectStore(FONT_STORE).put(record);
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(new Error(tx.error?.message ?? "写入用户字体失败"));
        };
      }),
  );
}

function allUserFonts(): Promise<Array<UserFontRecord>> {
  return openFontDB().then(
    (db) =>
      new Promise<Array<UserFontRecord>>((resolve, reject) => {
        const tx = db.transaction(FONT_STORE, "readonly");
        const request = tx.objectStore(FONT_STORE).getAll();
        request.onsuccess = () => {
          // eslint-disable-next-line typescript/no-unsafe-type-assertion -- IndexedDB 的 result 在 DOM 类型里是 any，落库数据由本模块自身写入、形状可信
          resolve(request.result as Array<UserFontRecord>);
        };
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "读取用户字体失败"));
        };
      }),
  );
}

/** 由二进制 BufferSource 注册一个 family 到 `document.fonts`（抛错由调用方接）。 */
async function registerFace(family: string, buffer: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, buffer, { weight: "1 1000" });
  await face.load();
  document.fonts.add(face);
}

/**
 * 注册一个用户字体文件：读二进制 → `FontFace` 注册进 `document.fonts` → 存进
 * IndexedDB，返回 family 名与可直接写回文本框的字体栈。任一环节失败都向上抛，由
 * 调用处（设置页）把错误告诉用户，而不是静默吞掉。
 */
export async function registerUserFont(
  file: File,
  tier: FontTier,
): Promise<{ family: string; stack: string }> {
  if (typeof document === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("当前环境不支持运行时字体加载");
  }
  const family = familyFromFileName(file.name);
  await registerFace(family, await file.arrayBuffer());
  await putUserFont({
    blob: file,
    family,
    fileName: file.name,
    format: formatForFile(file.name),
  });
  return { family, stack: fontStackForFamily(family, tier) };
}

/**
 * 启动时把 IndexedDB 里所有用户字体重新注册进 `document.fonts`。必须在
 * `applyAppearance` 之前跑（或之后也无妨：`font-display: swap` 语义下 family 没就绪
 * 时文字先走回退栈，注册完成再换上）。单条记录坏掉只跳过它，不让一条损坏字体堵死
 * 整次恢复。
 */
export async function restoreUserFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof indexedDB === "undefined") {
    return;
  }
  let records: Array<UserFontRecord>;
  try {
    records = await allUserFonts();
  } catch {
    return;
  }
  await Promise.all(
    records.map(async (record) => {
      try {
        await registerFace(record.family, await record.blob.arrayBuffer());
      } catch {
        /* 坏记录跳过：恢复是尽力而为，一处损坏不该拖垮其他字体。 */
      }
    }),
  );
}

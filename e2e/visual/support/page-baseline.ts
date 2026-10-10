import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 页面级像素基线的公共前置（§11.8）。
 *
 * 「页面级视觉」这一档归 Playwright；组件级形态归 Storybook
 * （两组分工与「不互相替代」的口径见规范 11 §11.8 / `docs/guide-storybook.md`）。
 * 每份 `*.visual.spec.ts` 都逃不掉同样三件事，所以收在这里 —— 三份 spec 各抄一遍
 * 就是 §12.12 的孪生对，而它们必然会在「加了一个新 chrome」时漂。
 */

/**
 * 与被测界面无关、却会逐帧变化的全局 chrome。
 *
 * 根布局给每个页面挂着全局 `BrowserStatusBar`（含**实时帧率与系统时钟**）—— 它不是
 * 被测界面却逐帧在变，桌面端 fullPage 因此永远取不到两张稳定截图（`Failed to take
 * two consecutive stable screenshots`）。像素层守的是布局 / 配色 / 尺寸，不是时钟读数。
 *
 * ⚠️ 这里**不再**包含 `nextjs-portal`（Next 的 dev 指示器）：它遮不住，实测两层原因 ——
 * 宿主元素 `getBoundingClientRect()` 是 **0×0**（角标挂在它的 shadow root 里，16 个子
 * 节点），而 Playwright 的 mask 按 bounding box 画，于是这条 mask 既没屏掉任何东西，
 * 又因为「按 count 决定加不加」变成**不确定性本身**。真正的做法是
 * {@link hideDevChrome}（导航前注入 `display:none`），并由 {@link settle} 里的
 * {@link expectDevChromeHidden} 兜底。
 */
export async function unstableChromeMasks(page: Page): Promise<Locator[]> {
  return [page.locator('[aria-label="底部状态栏"]')];
}

/** 注入样式的 `id`，用于重复调用时幂等。 */
const DEV_CHROME_STYLE_ID = "e2e-visual-hide-dev-chrome";

/**
 * 把 Next 的 dev 指示器**藏掉**，让 dev 口径与生产口径的像素可比。
 *
 * 为什么必须藏、而不是「别在 dev 口径录基线」就完事：`PLATFORM_RECORDING.win32`
 * 登记的口径就是 `dev`（win32 档只能在 Windows 开发机上录），而 `reuseExistingServer`
 * 让 Playwright 直接复用开发者**已经开着**的 dev server —— 于是 dev chrome 一定会出现在
 * 截图里。它的不确定形态实测有两种：同一个 `nextjs-portal` 有时是左下角一枚小圆角标，
 * 有时展开成一条约 150×40 的药丸（带版本 / 路由文字），后者单张能差出 2700 像素。
 * 藏掉宿主元素是唯一同时满足三件事的做法：像素确定、两口径同形、且不像 mask 那样
 * 在基线上留一条品红色块（那会把被遮区域的布局退化一起遮掉）。
 *
 * 用 `addInitScript` 而不是截图前 `addStyleTag`：指示器由 React 在水合后挂上，
 * 样式必须在它出现**之前**就在文档里，否则会出现「先画一帧再藏」的竞态。
 * 生产口径下没有这个元素 ⇒ 本函数是纯 no-op。
 *
 * 必须在 `goto` **之前**调（与 {@link setTheme} 同一条约束）。
 */
export async function hideDevChrome(page: Page): Promise<void> {
  await page.addInitScript(
    ([id]) => {
      const apply = () => {
        const target = document.head || document.documentElement;
        if (!target || target.querySelector(`#${id}`)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = "nextjs-portal{display:none !important}";
        target.appendChild(style);
      };
      /* 两条都要：`addScriptToEvaluateOnNewDocument` 可能在 `<html>` 都还没建出来时
         就跑，此时 `apply()` 空转；DOMContentLoaded 补一次，而它早于水合，赶得上
         指示器出现。 */
      apply();
      document.addEventListener("DOMContentLoaded", apply, { once: true });
    },
    [DEV_CHROME_STYLE_ID] as const,
  );
}

/**
 * 自检：dev 指示器**确实**没占位。
 *
 * 为什么单独一条判据：{@link hideDevChrome} 失效时的表现是「基线里多一个角标」，
 * 而它**当场不红** —— 下一次真差异里才混进来，还指不出是谁。所以把它变成录之前
 * 就要过的一道闸。
 *
 * 判的是 `display`，不是可见性：宿主本来就 0×0，Playwright 的 `toBeHidden()` 对
 * 「0×0」和「display:none」给的是同一个绿，用它等于没判。
 *
 * 不导出：唯一消费者就是下面的 {@link settle}，而每份 visual spec 都必经它。
 */
async function expectDevChromeHidden(page: Page): Promise<void> {
  const display = await page.evaluate(() => {
    const el = document.querySelector("nextjs-portal");
    return el ? getComputedStyle(el).display : null;
  });
  expect(
    display === null || display === "none",
    `dev 指示器没被藏住（display=${display}）—— 这张截图会把它烘进基线`,
  ).toBe(true);
}

/** 主题档：默认是 `dark`（`ThemeProvider` 的 `defaultTheme`），显式切要落 localStorage。 */
export const THEME_STORAGE_KEY = "theme";

/**
 * 在**首帧之前**把主题偏好写进 localStorage。
 *
 * 为什么不用 `document.documentElement.classList.add("dark")`：那是绕过
 * `next-themes` 直接改 DOM，水合时会被 Provider 的偏好覆盖，而且它只表达得出
 * 「暗」——浅色档（`light`）根本写不出来。写入 `theme` 键走的是用户真会走的那条路
 * （`ThemeProvider` 的 `storageKey` 就是它），两档都能表达。
 *
 * 必须在 `goto` 之前调（`addInitScript` 在每次导航前执行）。
 */
export async function setTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.addInitScript(
    ([k, v]) => localStorage.setItem(k, v),
    [THEME_STORAGE_KEY, theme] as const,
  );
}

/**
 * 等页面「静下来」再截图：关键文案可见 + 字体就绪 + dev chrome 已藏住。
 *
 * 三件都要。只等文案：字体还在换，字形像素会漂；只等字体：内容可能还没挂上；
 * 不查 dev chrome：{@link hideDevChrome} 哪天失效，基线就会安静地把角标烘进去，
 * 等到下一次真差异才混进来、还指不出是谁。
 */
export async function settle(page: Page, readyText: string): Promise<void> {
  await expect(page.getByText(readyText).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectDevChromeHidden(page);
}

/**
 * 把 ComfyUI 资源指标**钉成「后端不在」**，让首页「本机算力」卡可复现。
 *
 * 不钉的后果实测过：`/api/comfy/stats` 是服务端代理 ComfyUI `/system_stats`，而
 * `reuseExistingServer` 只看 8188 有没有人应答 —— 开发机上**真** ComfyUI 在跑时，
 * 假服务器根本没绑上端口，卡片于是渲染真实的显存 / 内存占用（`ram_free` 每秒在变），
 * 单张基线差出 142 像素，且**每台机器都不一样**。这种 PNG 不是基线，是机器指纹。
 *
 * 为什么钉成降级态而不是钉一组假数字：那正是生产口径（容器 / CI）没有 ComfyUI 时
 * 真服务端回的东西 —— 钉成它，`dev` 与 `start` 两档拿到同一张首页，已入库的
 * `-linux.png` 也不会被这次改动判红。「连着时数字长什么样」这一档的形态不归这里守，
 * 归 Storybook（`LocalComputeCard.stories.tsx`），与 §11.8 的页面级 / 组件级分工一致。
 *
 * 只拦 `/api/comfy/stats` 这一条，其余请求照旧走真服务端。
 */
export async function freezeComfyStats(page: Page): Promise<void> {
  await page.route("**/api/comfy/stats*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      /* 与真服务端降级分支同形（`src/app/api/comfy/stats/route.ts` 的
         `{ online: false, processAlive: snap.running }`）。 */
      body: JSON.stringify({ online: false, processAlive: false }),
    }),
  );
}

/**
 * 把首页「模型概览」卡的目录计数**钉成空**，让它渲染空态而不是骨架 / 真计数。
 *
 * 为什么必须钉：这一格的判据是 `model.configList` 的返回值 —— 服务端拿
 * `listModelFolders()`（扫本机 ComfyUI 的 `models` 目录）与
 * `modelCountsByFolder()`（数每个目录里有多少文件）现算。于是同一份 HTML 在
 * **两台机器上渲染出两张不同的卡**：
 *   · 开发机装过模型 → 列出「Checkpoints 12 个 / LoRA 40 个…」；
 *   · 容器 / CI 里什么都没有 → 那句「另有 N 个目录为空」的 `N` 也随本机目录数变。
 * 两者都不是「界面退化」，而是「基线记的是跑它的那台机器」(#1593 与 #1620 一、
 * 第 1 项实测的正是这一格)。
 *
 * 钉**空**而不是钉一组假计数：空态（`{folders: []}` → 「本机还没有同步到可用
 * 模型…」）正是容器 / CI 没有 ComfyUI 时的真形态，与 `freezeComfyStats` 钉成降级
 * 态同一个取向 —— 不复述一台机器的私有事实，只钉「这台机器上什么都没有」。
 * 「有模型时那块长什么样」不归页面级守，归 Storybook（`HomeModelOverview` 的
 * stories），与 §11.8 的页面级 / 组件级分工一致。
 *
 * ⚠️ 桩的**时机**才是这件事的难点，不是桩本身：`useModelOverview` 走
 * TanStack Query，`isLoading` 为真时渲染的是三行 `Skeleton` —— 而骨架与空态
 * **卡高不同**，于是首页从「模型概览」那一行往下整段位移。不桩时截图取到哪一态
 * 取决于这一拍请求回来了没有（实测差 4652 像素、差异集中在
 * `bbox=(407,480)-(1289,876)`），所以这一桩同时也是那个「录得出来但复现不了」的
 * 根因的修法。
 *
 * 必须在 `goto` **之前**调（`page.route` 只拦它注册之后发出的请求）。
 */
export async function freezeModelOverview(page: Page): Promise<void> {
  await page.route("**/api/trpc/**", async (route) => {
    if (!route.request().url().includes("model.configList")) {
      await route.continue();
      return;
    }
    /* 走真协议形态（JSON Lines）—— `route.fulfill` 一个 JSON 数组喂不进
     * `httpBatchStreamLink`（根因见 `../../support/trpc-stub` 的文件头）。
     * 动态 import 是为了让本模块不被 Playwright 的 TS 转换拉进 trpc-stub 的
     * `superjson` 依赖链（那个包是 ESM-only，静态 import 会在 config 求值期报错）。 */
    const { trpcJsonlBody } = await import("../../support/trpc-stub");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: trpcJsonlBody([{ folders: [], rows: [], comfyReachable: false }]),
    });
  });
}

/**
 * 清掉 `canvas-store` 的项目索引（localStorage）。
 *
 * 首页「最近项目」区渲染**空态占位卡**还是**真项目卡**，取决于这份索引 ——
 * 而它按浏览器上下文隔离、还可能被服务端对账（`hydrateFromServer`）改写。
 * 同一次上下文里跑过别的用例就会带上项目，于是基线随「上下文里有没有项目」变。
 *
 * 按**前缀**清而不是写死键名：`INDEX_KEY = "comfyapp.canvas.projects.v1"` 里的
 * `v1` 正是会随数据结构升级而漂的那一段，写死它等于给基线埋一颗定时炸弹
 * （版本号一升，清理静默失效、基线开始随上下文变，而没人知道为什么）。
 */
export async function clearProjectIndex(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("comfyapp.canvas.")) localStorage.removeItem(key);
    }
  });
}

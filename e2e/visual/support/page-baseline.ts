import { expect, type Locator, type Page } from "@playwright/test";

/* 字体档探针的输入面（样本串）与判决都定义在那一份 .mjs 里 ——
   静态 import 它会把整份脚本拉进 Playwright 的 TS 转换面，所以只在下面按需
   动态 import 判决；但这两个**常量**是纯数据，静态取来即可（样本串与判据必须
   同源，抄一份就是 §12.12 的孪生对）。 */
import {
  CJK_PROBE_SAMPLE,
  GLYPHLESS_PROBE_SAMPLE,
} from "../../../scripts/recording-font-capability.mjs";

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

/**
 * 自检：这台机器**有没有字体覆盖中文**（§11.8）。
 *
 * 为什么它不是「界面的一种状态」而是「这张 PNG 成立的前提」：基线文件名带**平台名**
 * （`-linux.png`），而平台名担保不了**字体栈** —— 实测同一个 linux 平台名下，两个容器
 * 跑同一份 spec / 基线 / 代码差 1767 像素，差的是整页中文的字形（ISSUE #1620）。
 * 这一档此前没有任何判据：名字里看不出这台机器录不录得出来，红的时候报的是一堆中文块
 * 的 diff，`classifyFailure` 认不出、会把人引去改业务代码。
 *
 * **判据的形状与话术都在 `scripts/recording-font-capability.mjs`**（§12.12）；
 * 这里只出**浏览器侧的读数** —— 同一串栈下，中文样本与「保证没有字形的码位」
 * （Unicode 私用区）各画一次、数非透明像素。两者**相等** ⇒ 中文渲染出来的是
 * 「缺字」的形状 ⇒ 这台机器没有 CJK 覆盖。
 *
 * 为什么不判「声明的字族在不在」（三条都被实测堵死，细节见那份 .mjs 的文件头）：
 * 清单会静默失效；`PingFang SC` / `Microsoft YaHei` 在**健康的** linux 容器上同样不在
 * （它靠别的 CJK 字体）；而按族名量 CJK 宽度分不出覆盖 —— 实测同一串中文在
 * `PingFang SC` / `Noto Sans SC` / `WenQuanYi Zen Hei`（本机真装了）下宽度**都是 120**。
 * `document.fonts.check()` 也不行：对一个不存在的族照样返 `true`。
 *
 * ⚠️ **不导出**：唯一消费者是 {@link settle}，而每份 visual spec 都必经它。
 */
async function expectRecordingFontCapability(page: Page): Promise<void> {
  const ink = await page.evaluate(
    ([cjk, glyphless, stackVar]: [string, string, string]) => {
      /* 栈从**解出来的**计算样式取，不照字面量喂给 canvas：`--font-sans` 里有
         `var(--font-geist-sans)`（next/font 在运行时挂上 `<html>`），照字面量喂过去
         是喂了一串解析不掉的 var()。 */
      const stack = getComputedStyle(document.documentElement)
        .getPropertyValue(stackVar)
        .trim();
      if (!stack) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 120;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      /** 把一串文字画上 canvas、数非透明像素 —— 就是「这串在这台机器上出了多少墨」。 */
      const measure = (text: string): number => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `48px ${stack}`;
        ctx.fillStyle = "#000";
        ctx.textBaseline = "top";
        ctx.fillText(text, 4, 4);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 8) n += 1;
        return n;
      };
      return { cjk: measure(cjk), glyphless: measure(glyphless) };
    },
    [CJK_PROBE_SAMPLE, GLYPHLESS_PROBE_SAMPLE, "--font-sans"] satisfies [
      string,
      string,
      string,
    ],
  );

  expect(
    ink,
    "读不到 --font-sans（token 没发射到 :root），字体档判据无法下结论",
  ).not.toBeNull();
  if (!ink) return;

  /* 判决定义在 `scripts/recording-font-capability.mjs`（与样本串同一处）。
     动态 import 的理由同 `freezeModelOverview`：本模块被 Playwright 的 TS 转换求值，
     静态 import 会把那份 .mjs 一并拉进转换面。 */
  const { verdictForInk } =
    await import("../../../scripts/recording-font-capability.mjs");
  const verdict = verdictForInk(ink);
  expect(verdict, verdict ?? undefined).toBeNull();
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
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [
    THEME_STORAGE_KEY,
    theme,
  ] as const);
}

/**
 * 等页面「静下来」再截图：关键文案可见 + 字体就绪 + dev chrome 已藏住 +
 * 打过的接口都登记过。
 *
 * 五件都要。只等文案：字体还在换，字形像素会漂；只等字体：内容可能还没挂上；
 * 不查 dev chrome：{@link hideDevChrome} 哪天失效，基线就会安静地把角标烘进去，
 * 等到下一次真差异才混进来、还指不出是谁；不查接口面：链路里新引进的数据源
 * 由跑它的那台机器回答，而这张 PNG 记的是那台机器的现场（见
 * {@link RECORDING_INPUT_CONTRACT}）；不查字体档：这台机器有没有字体覆盖中文 ——
 * 没有的话中文全是缺字形，而 `-<平台>.png` 这个名字看不出这一点
 * （见 {@link RecordingFontCapability}）。
 *
 * ⚠️ **前置调用**：{@link watchRecordingInputs} 必须在第一次 `goto` **之前**调，
 * 否则第四件判的是空集、永远绿。
 */
export async function settle(page: Page, readyText: string): Promise<void> {
  await expect(page.getByText(readyText).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectDevChromeHidden(page);
  /* 第四件：本屏打过的接口都登记过（{@link expectRecordingInputsDeclared}）。
     它与前三件同性质 —— 都是「这张 PNG 成立的前提」，不是界面的一种状态。 */
  expectRecordingInputsDeclared(page);
  /* 第五件：这台机器渲染中文用的是不是项目声明的那几族
     （{@link expectRecordingFontCapability}）。同样不是「界面的一种状态」，而是
     「这张 PNG 记的是录制环境还是这台机器的私有事实」这个前提。 */
  await expectRecordingFontCapability(page);
}

/**
 * 等首页「模型概览」卡**离开骨架态**。
 *
 * 为什么需要独立这一步（ISSUE #1691 第 1 条实测）：那一格的数据经 TanStack Query
 * 取，`isLoading` 为真时渲染三行 `Skeleton`、为假时渲染空态文案 —— **两态卡高不同**，
 * 于是首页从那一行往下整段位移。`freezeModelOverview` 钉的是「回来的是什么数据」，
 * **钉不住「哪一拍回来的」**：截图落在骨架那一拍，基线就记下了那张骨架
 * （实测差 4652 像素，`#1593` 记过同一格的现场）。
 *
 * 为什么现在才暴露：这一屏的「就绪锚点」原先钉的是首页欢迎区那块大标题，它落在
 * 模型概览**之后**渲染，于是顺带等到了这一格落定 —— 而那个锚点已按 ISSUE #1691
 * 移除，新锚点（入口卡）渲染得更早，这一格的竞态就露出来了。**修法不是在锚点上
 * 加回等待，而是把「这一格落定了」写成一条直的判据**：锚点该回答「这一屏画出来了」，
 * 而「每一块异步内容都到位了」是另一件事，混在一个 helper 里必然再被下一个人拆开。
 *
 * 判据取「这块卡里没有 skeleton」而不是「出现了某句文案」：文案会随空态 / 有数据
 * 两态变（而且它本来就是 `freezeModelOverview` 决定的那一格），而「骨架没了」
 * 对两态都成立。
 */
export async function expectModelOverviewSettled(page: Page): Promise<void> {
  const card = page.locator('[data-component="home-model-overview"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(0);
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

/**
 * 录制期请求面的**登记表** —— 每一条「这一屏会打的接口」都有明确处置与理由。
 *
 * 为什么需要它：{@link freezeComfyStats} / {@link freezeModelOverview} 这类桩是**逐个
 * 手写**的，而一份 spec 只会桩它「知道自己依赖」的那几格。实测一份只桩了 1 格的首页
 * spec，真实链路上有 **16 个** `/api/**` 请求——其余由「这台机器的 DB / ComfyUI / 日志
 * 目录 / 网络」在答。它们现在恰好没进像素（被 mask 遮着、在浮层里），但**没人知道是
 * 恰好**：谁把某块 chrome 挪出 mask 范围、或让某个降级态改成可见，基线就记住了一台机器
 * 的现场，而**当场不红** —— 这正是 #1593 / #1620 反复踩的那个形态。
 *
 * 所以「这一屏的输入」从**隐含**变成**显式**：{@link settle} 收尾时核一遍本屏打过的每个
 * 接口都在下表里，**没登记过的当场红并点名它的 URL**。新增一屏 / 改一屏引进了新数据源时，
 * 人会被当场要求回答一件事：「它进像素吗？」——进就封口，不进就写清为什么。
 *
 * 处置三档：
 *   · `pinned` —— 已由某个桩钉住（`screens` 写明是哪一个），值不再随机器变；
 *   · `masked` —— 值随机器变，但整块被 {@link unstableChromeMasks} 遮着、不进像素；
 *   · `offScreen` —— 被它驱动的 UI 不在本档截图的屏内（浮层未打开 / 元素未挂载）。
 *
 * ⚠️ `masked` 与 `offScreen` 都**不是**「安全」，是「这一档不判它」。它们随时可能因为
 * 布局调整而失效，而失效时本表看不出任何变化——所以 `note` 里必须写清「它靠什么不进
 * 像素」，那是下一个人判断这次改动有没有把它推进像素的唯一线索。
 */
export const RECORDING_INPUT_CONTRACT: Record<
  string,
  { how: "pinned" | "masked" | "offScreen"; note: string }
> = {
  "/api/comfy/stats": {
    how: "pinned",
    note: "freezeComfyStats —— 否则是本机实时显存 / 内存（每秒在变、每台机不同）",
  },
  "model.list": {
    how: "pinned",
    note: "模型库档用 stubTrpc 桩成空列表 —— 否则渲染的是跑它的这台机器上装了哪些模型",
  },
  "model.configList": {
    how: "pinned",
    note: "freezeModelOverview —— 否则是本机 ComfyUI 目录清单 + DB 里的模型计数",
  },
  "/api/comfy/queue": {
    how: "masked",
    note: "底部状态栏「排队」那一格，整条状态栏被 unstableChromeMasks 遮住；读本机 DB 的 task 表（容器里无表时它是 500）",
  },
  "/api/schema": {
    how: "masked",
    note: "底部状态栏「同步」那一格，同上被遮；随本机 DB 有没有建表变",
  },
  "/api/comfy/liveness": {
    how: "masked",
    note: "底部状态栏的 ComfyUI 探活，同上被遮；读本机进程表",
  },
  "/api/logs/current": {
    how: "masked",
    note: "LogPanel 的轮询，整块在未打开的浮层里；读本机 log/ 目录内容（每次启动都不同）",
  },
  "/api/dev/server-id": {
    how: "masked",
    note: "dev 口径的帧率 / 时钟读数所在那一格，同上被遮；dev server 每次启动都换",
  },
  "/api/dev/build-id": {
    how: "masked",
    note: "「页面还跑着上一版代码」检测，同上被遮；随每次构建变",
  },
  "/api/update-check": {
    how: "masked",
    note: "版本更新检测的轮询结果，只经 toast 呈现（不在 fullPage 截图里）；且依赖网络",
  },
  "project.list": {
    how: "pinned",
    note: "画布档用 stubTrpc 桩成空 —— hydrateFromServer() 会用服务端那一份覆盖本地项目",
  },
  "/api/production": {
    how: "pinned",
    note: "freezeProductionShots —— 否则本机 DB 里这个项目的 production.shots 会物化成画布节点（实测差 2 个节点）",
  },
  "workflow.list": {
    how: "pinned",
    note: "画布档用 stubTrpc 桩成空 —— 读本机 DB 的工作流模板表，且扫磁盘上的本地工作流根目录",
  },
  "workflowModel.list": {
    how: "pinned",
    note: "画布档用 stubTrpc 桩成空 —— 读本机 DB 的模型标签库",
  },
  "project.upsert": {
    how: "offScreen",
    note: "画布落盘时的写回，只写不渲染；本档不判它（它读本机 DB，容器里无表时会 500，但那不进像素）",
  },
};

/**
 * 本屏打过的接口型请求（`/api/**`），规范化成「路径」形态后累积 —— 同一个 URL
 * 只记一次，`?query` 与 tRPC 的 batch 入参都裁掉（它们逐次不同，却是**同一个**数据源）。
 *
 * 挂在 page 上（`WeakMap` 而不是模块级变量）：一个 worker 里多个 page 并发，
 * 模块级变量会让两份 spec 的请求混在一起，报出来的未声明清单指向别人那一屏。
 */
const seenInputs = new WeakMap<Page, Set<string>>();

/**
 * 规范化一条请求 URL 成「数据源」的形态（**一条请求可能产出多条**）。
 *
 * 裁掉 query 与 hash：`/api/logs/current?source=app&offset=0` 与
 * `…offset=5168432` 是同一个数据源的两拍。
 *
 * tRPC 单独处理：批请求把多个过程名用逗号拼在同一段路径里（实测
 * `/api/trpc/project.list,project.upsert`、`/api/trpc/model.list,model.list`），
 * 而「哪几个过程被凑进同一批」是**调用时机**的产物，不是数据源的身份 —— 同一个
 * 数据源单发是 `model.list`、批量是 `model.list,model.list`。所以拆成
 * **每个过程一条** `/api/trpc/<过程名>`（与 {@link stubTrpc} 的匹配口径同源，
 * 契约表里直接写过程名即可）。
 *
 * 只认 `/api/` 前缀：RSC payload（`?_rsc=…`）、静态资源、`/workspace` 这类导航
 * 请求不是「数据源」——前者是本次导航的传输形态，后者就是被测页面本身。
 *
 * 不导出：唯一消费者是 {@link watchRecordingInputs}，而它判的形态（保留哪一段路径）
 * 是它自己的私有约定。
 *
 * @param rawUrl 请求的完整 URL
 * @returns 数据源形态（不在 `/api/` 下返回空数组）
 */
function normalizeInput(rawUrl: string): string[] {
  const { pathname } = new URL(rawUrl);
  if (!pathname.startsWith("/api/")) return [];
  const trpcPrefix = "/api/trpc/";
  if (!pathname.startsWith(trpcPrefix)) return [pathname];
  return pathname
    .slice(trpcPrefix.length)
    .split(",")
    .filter(Boolean)
    .map((procedure) => `${trpcPrefix}${procedure}`);
}

/**
 * 开始记录本屏打过的接口 —— **必须在第一次 `goto` 之前调**。
 *
 * `page.on("request")` 只抓注册之后发出的请求，而导航一发起就开始打接口了；在
 * `goto` 之后调等于漏掉首屏那一批，而那批恰好是环境依赖最重的一批（`model.configList`、
 * `comfy/stats` 全在里面）。
 *
 * 幂等：同一个 page 重复调不会累积两套监听（`WeakMap` 里已有就返回）。
 */
export async function watchRecordingInputs(page: Page): Promise<void> {
  if (seenInputs.has(page)) return;
  const seen = new Set<string>();
  seenInputs.set(page, seen);
  page.on("request", (req) => {
    for (const input of normalizeInput(req.url())) seen.add(input);
  });
}

/**
 * 自检：本屏打过的接口，每一条都在 {@link RECORDING_INPUT_CONTRACT} 里。
 *
 * 判据的形状是「**没登记过的**就红」，不是「没封口的就红」——因为「这一格进不进像素」
 * 是一个需要人回答的问题（进就封口、不进就写清靠什么不进），不是机器猜得出来的。
 * 机器能做的是**逼这个问题被回答**，并且把答案留在仓库里。
 *
 * 报错里带「怎么处置」的两条出路：封口（新增桩函数并在契约表登记 `pinned`），或
 * 登记为 `masked` / `offScreen` 并写清理由。两条都比「哦它居然打了这个接口」有用。
 *
 * 没调过 {@link watchRecordingInputs} 时**不判**（`settle` 的既有调用方还没有一个
 * 都接上监听）：沉默地放行不是漏判，是「这一屏还没纳入这条判据」——接上监听那一行
 * 就是纳入的动作，`tests/visual-recording-inputs.test.ts` 会盯住每份 spec 都接上。
 */
export function expectRecordingInputsDeclared(page: Page): void {
  const seen = seenInputs.get(page);
  if (!seen) return;
  const undeclared = [...seen]
    .filter(
      (input) =>
        !Object.keys(RECORDING_INPUT_CONTRACT).some((key) =>
          input.includes(key),
        ),
    )
    .sort();
  expect(
    undeclared,
    "本屏打过的接口里有没登记的（基线会随跑它的那台机器变）：\n" +
      undeclared.map((input) => `  · ${input}`).join("\n") +
      "\n  处置二选一：\n" +
      "    ① 它进像素 ⇒ 加一个桩把它钉住（如 freezeComfyStats），在\n" +
      "       e2e/visual/support/page-baseline.ts 的 RECORDING_INPUT_CONTRACT 登记 `pinned`；\n" +
      "    ② 它不进像素 ⇒ 登记 `masked` / `offScreen`，并在 note 里写清**靠什么**不进\n" +
      "       （被哪条 mask 遮着 / 为什么不在截图范围里）。",
  ).toEqual([]);
}

/**
 * 把画布的「生产数据」（`/api/production`）钉成**没有镜头**的形态。
 *
 * 为什么必须钉（这条是**实测**出来的，不是照着别的屏推的）：`ProjectCanvas` 挂载时
 * 调 `fetchProduction()`，再把 `production.shots` 经 `materializeProductionShots()`
 * **物化成画布节点** —— 有镜头就多出对应数量的节点，没有就原样返回。所以这一屏的
 * 节点数直接由「本机 DB 里这个项目有没有 production 记录」决定。
 *
 * 实测：给这一屏临时喂两条镜头，`canvas.visual.spec.ts` 的「4 节点 / 3 边」断言
 * **当场红**（变成了 6 个节点）——也就是说，在「建过表、且该项目存过生产数据」的机器上
 * 录这份基线，录出来的会是一张**多两个节点**的图，而容器里是 4 个。
 *
 * 钉**不存在**（`{exists: false}`）而不是钉一组假镜头：`fetchProduction` 判的是
 * `data.exists === true`，非真即 `null` —— 而「没有这一行」正是干净环境（容器 / CI）
 * 的真形态，与 {@link freezeComfyStats} 钉成降级态同一个取向。「有镜头时画布长什么样」
 * 不归页面级守，归 Storybook。
 *
 * 必须在 `goto` **之前**调（`page.route` 只拦它注册之后发出的请求）。
 */
export async function freezeProductionShots(page: Page): Promise<void> {
  await page.route("**/api/production*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      /* 与真服务端「无该行」分支同形（`src/app/api/production/route.ts` 的 GET）。 */
      body: JSON.stringify({ exists: false }),
    }),
  );
}

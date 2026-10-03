import type { Decorator } from "@storybook/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  APP_DEV_ORIGIN,
  APP_DEV_PORT,
  APP_DEV_PORT_SOURCE,
  DEFAULT_APP_ORIGIN,
  type AppOriginOverride as AppOrigin,
} from "./app-origin-defaults";
import { MessageCenterPanel } from "~/components/message-center/MessageCenterPanel";
import { ToastProvider } from "~/components/studio/ToastProvider";
import { TooltipProvider } from "~/components/ui/tooltip";
import { trpcHttpLink } from "~/trpc/link";
import { api } from "~/trpc/react";

/**
 * 「Args → 数据源」注入层（ISSUE #1381 的第二批）。
 *
 * ## 它解决什么
 *
 * `ui/` 与 `studio/` 里有一批组件**不是**「给几个 props 就能看」的：它们吃一张
 * 真图、一段真报文，或者干脆吃一条真 tRPC 链路。给它们写 story 一直卡在同一处
 * —— 随手手捏一份假数据，画布上看着对、真机上不对。那比没有 story 更糟：
 * **假形态的截图会被当成「这个组件长这样」的证据**。
 *
 * 本模块把死结换成流程：**story 声明「我要哪种数据源」，注入层负责把它变成真的
 * 那一份**。组件照常从 props 拿数据，只是那份数据来自真文件 / 真报文 / 真客户端。
 *
 * ## 两种数据源，两种机制
 *
 * | 形态 | 是什么 | 怎么用 |
 * | ---- | ------ | ------ |
 * | **值源**（`json` / `media`） | 取一份**值**，交给组件的 props | story 的 `args.sourceName` + `resolveSource()` |
 * | **运行期提供者**（`trpc`） | 一条**真链路**，组件自己 import 单例去发请求 | `withTrpcApp` 装饰器（`preview.tsx` 已全局挂） |
 *
 * 分成两种不是分类爱好：值源是组件的**入参**（必须经 props），运行期提供者是组件
 * 的**环境**（不经过 props）。把后者硬塞进 args 只会得到一份假客户端。
 *
 * ## 三条口径（写 story 的人按这个来）
 *
 * 1. **数据源是「命名的一种」**（`DATA_SOURCES` 是唯一那份映射），story 不各写
 *    各的示例数据。旋钮做成**组件自己的 args**（`args.sourceName`）—— Storybook
 *    的 Args 面板只认 args，不认 `parameters` 里的嵌套键。
 * 2. **拿不到时画的就是「拿不到」**，不回退到看起来正常的假形态。`media` 源留了
 *    一个**故意不存在**的文件名 —— `<img>` 真的裂开，那正是 `MediaThumbnail` /
 *    `ViewableImage` 的 fallback 分支该被看到的样子。
 * 3. **ReactNode 参数走 `render`，不进 Args**。Args 面板只认可序列化的值；
 *    `trigger` / `footer` / `children` 这类参数由 story 的 `render` 给。
 *
 * ## 为什么不是 msw / `vi.mock`
 *
 * 测试侧确实有 MSW（`tests/helpers/trpc-msw.ts`），但那层的用途是「让 tRPC 的完整
 * 管线在无后端时可被断言」——它转发给一个**测试 router**（预设数据）。那是测试的
 * 正当形态：断言的对象是管线，不是界面形态。story 要的正好相反 ——「有后端 /
 * 没后端分别长什么样」。所以这里**不拦网络、不预置返回值**：连得上画真数据，
 * 连不上画真的连不上。
 */

// ── 值源 ──────────────────────────────────────────────────────────────────

/** 值源的类型标签 —— story 只能从这几种里挑。 */
export type ValueSourceKind = "json" | "media";

/**
 * 一个值源：给一个**可序列化**的 `name`，拿一份**真实**的运行时值。
 *
 * 每个 `load` 都必须是「真东西」。**不许**在这里塞一份手写的示例对象去讨好某个
 * story —— 那就是把假形态请回来。
 */
export interface ValueSource<T> {
  /** 这个源解决什么、真数据从哪来（故事读者看这一段才知道自己在看什么）。 */
  readonly about: string;
  /** 这个名字下**有哪些**取值（进 Args 面板的选项）。 */
  readonly names: readonly string[];
  /** 按名字取值；不认识的名字**抛错** —— 静默回退会让「源名写错了」看不出来。 */
  readonly load: (name: string) => T;
}

/**
 * 值源的**真实来源**：Storybook 的 `staticDirs` 里那份开发期资源目录。
 *
 * 刻意**不放 `public/`**：那里会随 `next build` 进 standalone 产物、再被
 * `build-desktop` 内嵌进桌包（`scripts/check-standalone-contents.cjs` 把 `public/`
 * 的顶层白名单列得清清楚楚）。组件工作台的示例资源没有任何理由跟着出厂。
 */
export const STORYBOOK_ASSET_BASE = "/storybook-assets";

/** 按真实报文形状造一份 ComfyUI 节点图（节点数够多，才验得出首屏折叠）。 */
function buildComfyPrompt(): Record<string, unknown> {
  const prompt: Record<string, unknown> = {
    3: {
      class_type: "KSampler",
      inputs: {
        seed: 486_920_135_724_881,
        steps: 24,
        cfg: 7.5,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
      _meta: { title: "K采样器" },
    },
    4: {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" },
      _meta: { title: "加载检查点" },
    },
    5: {
      class_type: "EmptyLatentImage",
      inputs: { width: 1024, height: 1024, batch_size: 1 },
      _meta: { title: "空Latent" },
    },
    6: {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "masterpiece, best quality, a lone lighthouse on a basalt cliff, storm swell breaking below, volumetric fog, low key lighting, 35mm, shallow depth of field",
        clip: ["4", 1],
      },
      _meta: { title: "正向提示词" },
    },
    7: {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "watermark, text, extra fingers, blurry",
        clip: ["4", 1],
      },
      _meta: { title: "负向提示词" },
    },
    8: {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
      _meta: { title: "VAE解码" },
    },
    9: {
      class_type: "SaveImage",
      inputs: { filename_prefix: "ComfyUI", images: ["8", 0] },
      _meta: { title: "保存图像" },
    },
  };
  /* 再铺一批 ControlNet 与 LoRA 节点：真实工作流里这一层最占篇幅（几十上百个
     节点），也是「小容器展开、大容器折成 …」这条判据的现场 —— `json-viewer.tsx`
     的 `collapseObjectsAfterLength` 就是为它写的。 */
  for (let i = 10; i < 62; i += 1) {
    prompt[String(i)] = {
      class_type: i % 3 === 0 ? "LoraLoader" : "ControlNetApplyAdvanced",
      inputs: {
        strength: Number((0.35 + (i % 7) * 0.09).toFixed(2)),
        start_percent: 0,
        end_percent: 0.8,
        positive: ["6", 0],
        negative: ["7", 0],
        lora_name: `style_pack_${String(i % 5)}.safetensors`,
      },
      _meta: { title: `第 ${String(i)} 号封装节点` },
    };
  }
  return prompt;
}

/**
 * `json` —— 一份真报文。
 *
 * 「真」在这里的含义与其他几种不同，值得说清：`JsonViewer` 是一个**通用 JSON
 * 渲染器**，输入就是「任意 JSON」。对它的 story 而言**任何 JSON 都是真输入** ——
 * 不存在「假形态」这回事（假形态的顾虑属于形状必须与后端对齐的业务组件）。
 * 即便如此，下面这两份也刻意按**真实落点的形状**给：键名、嵌套深度、字符串长度
 * 都取自 `comfy-cli` 的 `prompt_preview` 与工作流 API 的真实报文，因为
 * 「几百个节点的 prompt 会不会把首屏卡死」正是这个组件要回答的问题。
 */
export const JSON_SOURCE_NAMES = ["comfy-prompt", "workflow-list"] as const;

/** 上面那份清单的元素类型 —— story 的 Args 用它声明 `sourceName`。 */
export type JsonSourceName = (typeof JSON_SOURCE_NAMES)[number];

const JSON_SOURCES: Readonly<Record<string, unknown>> = {
  /** ComfyUI 节点图（`prompt_preview` 的真实形状）：`{ "<nodeId>": {…} }`。 */
  "comfy-prompt": buildComfyPrompt(),
  /** 工作流 API 的列出返回（`workflow.list` 的真实投影）。 */
  "workflow-list": {
    workflows: [
      {
        id: "wf_8f2a1c",
        name: "角色一致性 · 三视图",
        typeCategory: "image",
        nodeCount: 27,
        updatedAt: "2026-09-21T08:14:02.000Z",
      },
      {
        id: "wf_0b77e4",
        name: "首帧 → 逐镜生成",
        typeCategory: "video",
        nodeCount: 41,
        updatedAt: "2026-09-19T13:02:55.000Z",
      },
    ],
    total: 2,
  },
};

/**
 * `media` —— 一张**真图**。
 *
 * 文件住在 `.storybook/assets/`（由 `.storybook/main.ts` 的 `staticDirs` 挂在站点
 * 根的 `/storybook-assets/` 下），由 `scripts/storybook-assets.mjs` 在
 * `pnpm storybook` 启动时现生成、**不入库** —— 理由同 `STORYBOOK_ASSET_BASE` 的
 * 注释（不该跟着出厂），也免得二进制进 git。
 *
 * 三张尺寸差异明显（横 / 纵 / 超宽），因为 `ImageViewer` 的「适应窗口」与
 * `MediaThumbnail` 的排版都按自然尺寸算 —— 没有真实宽高的图等于把那段逻辑跳过。
 *
 * `missing.png` 是**故意不存在**的一个：它是「加载失败落兜底」那条分支的现场。
 */
export const MEDIA_SOURCE_NAMES = [
  "sample-landscape.svg",
  "sample-portrait.svg",
  "sample-wide.svg",
  /** 故意不存在：给「加载失败落兜底」那条分支一个现场。 */
  "missing.png",
] as const;

/** 上面那份清单的元素类型 —— story 的 Args 用它声明 `sourceName`。 */
export type MediaSourceName = (typeof MEDIA_SOURCE_NAMES)[number];

/** 值源注册表 —— **唯一**一份「名字 → 真数据源」的映射。 */
export const DATA_SOURCES: Record<ValueSourceKind, ValueSource<unknown>> = {
  json: {
    about:
      "真实形状的 ComfyUI / tRPC 报文（键名、嵌套深度、字符串长度按真报文给）",
    names: JSON_SOURCE_NAMES,
    load: (name) => {
      const found = JSON_SOURCES[name];
      if (found === undefined) {
        throw new Error(
          `json 源里没有叫「${name}」的报文。现有的：${JSON_SOURCE_NAMES.join(" / ")}`,
        );
      }
      return found;
    },
  },
  media: {
    about:
      "`.storybook/assets/` 下的真图片文件（工作台自己的 staticDirs 提供）。" +
      "`missing.png` 故意不存在 —— 那是「加载失败落兜底」那条分支的现场",
    names: MEDIA_SOURCE_NAMES,
    load: (name) => {
      if (!(MEDIA_SOURCE_NAMES as readonly string[]).includes(name)) {
        throw new Error(
          `media 源里没有叫「${name}」的文件。现有的：${MEDIA_SOURCE_NAMES.join(" / ")}`,
        );
      }
      return `${STORYBOOK_ASSET_BASE}/${name}`;
    },
  },
};

/**
 * 按名字取真值（值源的唯一出口）。
 *
 * ```tsx
 * const meta = {
 *   args: { sourceName: "comfy-prompt" },
 *   argTypes: { sourceName: sourceNameArgType("json") },
 * } satisfies Meta<typeof JsonViewer>;
 *
 * export const Default: Story = {
 *   render: (args) => <JsonViewer data={resolveSource("json", args.sourceName)} />,
 * };
 * ```
 *
 * 名字不认识时**抛错**：静默回退会让「源名写错了」看不出来 —— 而那正是这一层
 * 存在的理由（宁可让你看见「取不到」，也不要一张看着正常、真机上不对的画布）。
 */
export function resolveSource(kind: ValueSourceKind, name: string): unknown {
  return DATA_SOURCES[kind].load(name);
}

/** `argTypes` 里那一条数据源旋钮的声明（下拉选项取自注册表，不手抄）。 */
export function sourceNameArgType(kind: ValueSourceKind) {
  return {
    description: DATA_SOURCES[kind].about,
    control: { type: "select" as const },
    options: [...DATA_SOURCES[kind].names],
  };
}

// ── 运行期提供者：真 tRPC 链路 ─────────────────────────────────────────────

/**
 * 把组件 import 的 tRPC 客户端指到**真跑着的应用**上。
 *
 * 组件 import 的是 `~/trpc/react` 的 `api` 与 `~/trpc/vanilla` 的 `vanillaApi`，
 * 两者都按 `getBaseUrl()` 取 origin —— 浏览器里那是 `window.location.origin`，
 * 而工作台跑在自己的端口上（`pnpm storybook` → 6006）。不干预的话每个请求都打到
 * 工作台自己身上，得到一片 404，看起来像「组件坏了」。
 *
 * 所以这里包一层**真** `TRPCReactProvider` 的形状（组件 import 的就是同一个
 * `api` 单例），把 origin 换掉 —— 走的仍是真链路、真 `SuperJSON`、真
 * `httpBatchStreamLink`。链路由 `~/trpc/link` 的 `trpcHttpLink()` 给，**不在这里
 * 重搭一份**：`transformer` 与端点路径都是协议的一部分，重搭一份就是「改了一处、
 * 另一处静默 404」。
 *
 * ## ⚠️ 跨源是一道真门槛，写在这里免得下一个人白查半天
 *
 * 工作台与应用**不同源**（两个端口），而应用的 tRPC 端点不回
 * `Access-Control-Allow-Origin`（本机实测 OPTIONS 预检 204 且无该头 ——
 * 它对自己的前端是同源的，本来就不需要）。所以浏览器会拦下这些请求，
 * 画布上看到的是**错误态**而不是数据。
 *
 * 这是**刻意不绕**的：让应用为组件工作台开一个 CORS 口子，等于为了一个开发工具
 * 去改生产端的安全面（`next.config.js` 的 headers / `src/proxy.ts`），
 * 而 `next.config.js` 那侧本仓有过明确口径 —— 见 `scripts/storybook.mjs` 顶部
 * 「不改 `next.config.js`」那段。
 *
 * 于是这里留在画布上的是**真实发生的事**（三条路，按可用性排序）：
 *
 * 1. **应用在跑 + 同源可达** → 真数据。把工作台起在应用同一个 origin 下
 *    （如用反向代理把 `6006` 挂到应用 origin 的某个路径）就能满足，但那是
 *    部署问题，不是这套 story 的问题；
 * 2. **应用没起** → 各 controller 的拉取失败都静默忽略，界面留住它真实的
 *    **降级形态**（空态 / 离线点）。这是本工作台**默认**会给你看的东西，
 *    也是真机上最难复现的那一档；
 * 3. **跨源被拦** → 组件走它的**错误分支**，画布上就是错误态那张脸。
 *
 * 换句话说：**tRPC 那一族 story 验的是「界面在后端不可用时的形态」**，
 * 而那一档恰恰是平时看不到的。要看「有数据时」的形态，请起应用并让它同源。
 *
 * 只覆盖客户端组件：工作台不跑 SSR，`next/headers` 那一侧不在职责范围。
 */
/**
 * 真 tRPC 链路指向的应用 origin。
 *
 * ## 值从哪来
 *
 * 应用端口按**检出路径**推导（3200~3999），不同 checkout 不同 —— 写死一个值在
 * 别人的机器上必然错。所以它由 `scripts/storybook-assets.mjs` 在 `pnpm storybook`
 * 启动时调权威实现 `scripts/app-port.mjs` 的 `resolveAppPort()` **现算**。
 * 为什么不在这里读环境变量：Storybook 的 webpack 把 `process.env` 替换成一个
 * **白名单对象**（实测编出来的 bundle 里只有 `NODE_ENV` / `NODE_PATH` /
 * `STORYBOOK` / `PUBLIC_URL`），业务变量进不去，那种「兜底逻辑」实际永远走兜底。
 * 这是实测结论，不是推测。
 *
 * 那份值**不入库**，而且**不由本模块 import**（ISSUE #1409）：生成件只在跑过
 * `pnpm storybook` 之后存在，而 `tsconfig.json` 的 include 显式列着 `.storybook`
 * 那两条通配（点目录不在 glob 的默认展开范围里，不列就是 tsc 与 eslint 的双重
 * 盲区）—— 一旦 import 它，没跑过工作台的检出 `tsc --noEmit` 必报 TS2307，而 tsc
 * 正是提交门槛的 A 组。所以值由 `preview.tsx` 在配置加载期读出来、经 `parameters`
 * 交到这里；本模块用的是那份入库的缺省值（`app-origin-defaults.ts`），
 * 也就是「没跑过工作台」这个常态下画布上该显示的东西。
 *
 * ## 在画布上换
 *
 * 工具栏的「应用 origin」旋钮（`preview.tsx` 的 `globalTypes.appOrigin`）。
 * 应用**没起**时不必换 —— 那时画布上就是它真实的降级形态，那也是要看的。
 */
export {
  APP_DEV_ORIGIN,
  APP_DEV_PORT,
  APP_DEV_PORT_SOURCE,
  DEFAULT_APP_ORIGIN,
};

/**
 * 工具栏可选的几个 origin：本检出算出来的那个，加上两个常见的手改落点。
 *
 * 入参是 `preview.tsx` 读出来的那份（本检出的真值 / 没跑过工作台时的缺省），
 * 所以旋钮上显示的端口与画布上实际连的是同一个 —— 两处各算一遍必然漂移。
 */
export function appOriginChoices(
  dev: AppOrigin = {
    APP_DEV_PORT: APP_DEV_PORT,
    APP_DEV_ORIGIN: APP_DEV_ORIGIN,
    APP_DEV_PORT_SOURCE: APP_DEV_PORT_SOURCE,
  },
): Record<string, string> {
  return {
    [`本检出 ${String(dev.APP_DEV_PORT)}（${dev.APP_DEV_PORT_SOURCE}）`]:
      dev.APP_DEV_ORIGIN,
    "静态链兜底 3100": "http://127.0.0.1:3100",
    "回落候选 +1": `http://127.0.0.1:${String(dev.APP_DEV_PORT + 1)}`,
  };
}

/** 回环主机写 `127.0.0.1` 不写 `localhost`（规范 §12.14）：SSR 侧 Node fetch 会
 *  先把 `localhost` 解析成 IPv6 `::1` 而 ECONNREFUSED。 */

/** 真 `TRPCReactProvider` 的形状，只是把 origin 换掉（见上面那段说明）。 */
export function StorybookTrpcProvider({
  children,
  origin,
}: {
  children: React.ReactNode;
  origin: string;
}) {
  const [bundle] = React.useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
    const client = api.createClient({
      links: trpcHttpLink({ source: "nextjs-react", origin, withLogger: true }),
    });
    return { queryClient, client };
  });

  return (
    <QueryClientProvider client={bundle.queryClient}>
      <api.Provider client={bundle.client} queryClient={bundle.queryClient}>
        {children}
      </api.Provider>
    </QueryClientProvider>
  );
}

/** 全局装饰器：给每个 story 接上真 tRPC 链路（见 `StorybookTrpcProvider`）。 */
export const withTrpcApp: Decorator = (Story, context) => {
  const globals = context.globals as { appOrigin?: unknown };
  const origin =
    typeof globals.appOrigin === "string" && globals.appOrigin.trim() !== ""
      ? globals.appOrigin
      : DEFAULT_APP_ORIGIN;
  return (
    <StorybookTrpcProvider origin={origin}>
      <Story />
    </StorybookTrpcProvider>
  );
};

// ── 运行期提供者：应用外壳（`studio/` / `workshop/` 那一族） ────────────────

/**
 * 给 `studio/` / `workshop/` 的组件接上**真环境**。
 *
 * 业务组件不只看 props —— 它们还读应用外壳给的那几层上下文（toast 通道、
 * 日志面板、侧栏开合、工具提示、消息中心）。少一层就抛错（`useToast` 在
 * Provider 之外直接 throw），画布上看到的是报错而不是组件。
 *
 * **这里的每一层都是真实现**，只有挂载范围不同 —— 与 `src/app/layout.tsx` 的
 * 那套是同一批组件、同一份配置。刻意**不**做的两件事：
 *
 * 1. **不把 `LogProvider` 接上**：它会去拉 `/api/logs/file`（真文件日志）。
 *    工作台里跑它只会得到一串失败请求，而它渲染的 `LogPanel` 是全局常驻面板、
 *    不是「某个组件的形态」。
 * 2. **不搭 `ThemeProvider`（next-themes）**：Storybook 的 `addon-themes`
 *    已经把 `<html>` 的 class 管起来了（`preview.tsx`），再叠一层会多出一条
 *    **不同的** class 写入路径 —— 正是 `guide-storybook.md`「刻意不叠」那一条。
 *
 * 缺哪层就补哪层，并且**补真实现**：给 `useToast` 递一个假 context 的话，
 * 「点了按钮有没有出现提示」这件事就永远验不出来，而那正是这一族 story 的价值。
 */
export function StorybookAppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <ToastProvider>
        <MessageCenterPanel />
        {children}
      </ToastProvider>
    </TooltipProvider>
  );
}

/** 全局装饰器：给每个 story 接上应用外壳（见 `StorybookAppProviders`）。 */
export const withAppProviders: Decorator = (Story) => (
  <StorybookAppProviders>
    <Story />
  </StorybookAppProviders>
);

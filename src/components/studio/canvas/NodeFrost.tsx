"use client";
import { Z } from "~/lib/shell/overlay-z";
import { useStore } from "@xyflow/react";
import { pseudoFrostPalette, hexToRgba } from "../workflow-utils";
export const PSEUDO_FROST_NOISE_URL =
  // 180×180 的湍流噪声 tile；透明度约 0.55；内联 SVG ⇒ 不额外增加 HTTP 请求。
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.7' numOctaves='2' seed='9'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>";

/* 合成的色块布局 —— 五个互相重叠的椭圆铺满节点主体。
 * 位置与尺寸都用百分比，所以这层会随节点被 React Flow 施加的 `minWidth`
 * 自然重排，不必做任何布局上的小动作。每个色块各用自己的 `filter: blur(Npx)`，
 * 于是即使父级缩放施加了 CSS `transform: scale(...)`，轮廓仍然是柔和的。 */
export const PSEUDO_FROST_BLOBS: {
  left: string;
  top: string;
  w: string;
  h: string;
  alphaKey: "primary" | "secondary" | "cool" | "warm" | "shadow";
  blurPx: number;
}[] = [
  {
    left: "6%",
    top: "10%",
    w: "58%",
    h: "42%",
    alphaKey: "primary",
    blurPx: 28,
  },
  {
    left: "18%",
    top: "62%",
    w: "62%",
    h: "32%",
    alphaKey: "secondary",
    blurPx: 22,
  },
  { left: "62%", top: "6%", w: "40%", h: "50%", alphaKey: "cool", blurPx: 32 },
  { left: "30%", top: "30%", w: "32%", h: "32%", alphaKey: "warm", blurPx: 18 },
  {
    left: "66%",
    top: "56%",
    w: "30%",
    h: "34%",
    alphaKey: "shadow",
    blurPx: 24,
  },
];

/* 构建每个模式对应的颜色表，供 `PSEUDO_FROST_BLOBS.alphaKey` 使用。
 * 禁用态偏灰、绕过态偏粉紫；冷 / 暖 / 阴影三个通道保持不变，
 * 因此无论哪种模式，面板读起来都是一块连贯的玻璃面。 */
export function PseudoFrostLayer({ modeColor }: { modeColor: string | null }) {
  if (!modeColor) return null;
  const palette = pseudoFrostPalette(modeColor);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
      style={{ zIndex: Z.base }}
    >
      {PSEUDO_FROST_BLOBS.map((blob, idx) => (
        <div
          key={`blob-${idx}`}
          className="absolute rounded-full"
          style={{
            left: blob.left,
            top: blob.top,
            width: blob.w,
            height: blob.h,
            background: palette[blob.alphaKey],
            filter: `blur(${blob.blurPx}px)`,
          }}
        />
      ))}
      {/* 最后一层噪声叠加 —— 补上纯模糊光斑单靠自己
       *  缺少的那种细腻「磨砂」质感。Mix-blend 让彩色光斑
       *  给它上色，而不是把它压在底下。 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${PSEUDO_FROST_NOISE_URL}")`,
          backgroundSize: "180px 180px",
          opacity: 0.085,
          mixBlendMode: "overlay",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  NodeFrost —— 绕过 / 禁用节点用的**真·透视**毛玻璃层。
 *
 *  它用真正的 `backdrop-filter: blur(...)`，被模糊的是节点背后**真实的画布**
 *（不是合成的色块）。Chromium 有个经典 bug：`backdrop-filter` 在屏幕上
 *  尺寸极小的元素上会**重铺平铺** —— 缩小时节点的屏幕占位变小，模糊核超出
 *  它的底层纹理，边缘像素开始回绕 → 于是用户看到的 2² / 3² / 4²（即 4 / 9 / 16）
 *  重影伪影。
 *
 *  修法：缩小时把模糊元素按 1/zoom 反向缩放，让它的**屏幕占位**保持在
 *  节点 zoom=1 时的尺寸（那个大小总够干净地模糊）。外层 wrapper 再用
 *  `overflow:hidden` 裁回节点边界，于是只显示「与节点同形的那一片」采样背景
 *（此时它已经足够大）。模糊半径除以同一个比例，
 *  让各个缩放档下的有效屏幕模糊都约为 6px。结果就是：真实画布的真模糊视图，
 *  任何缩放档都不平铺。 */
export function NodeFrost({
  zoom,
  color,
  nodeMode,
}: {
  zoom: number;
  color: string | null;
  nodeMode: number;
}) {
  if (!color || nodeMode === 0) return null;
  // 让屏幕占位不小于节点 zoom=1 时的尺寸。
  const scale = Math.max(1, 1 / Math.max(zoom, 0.01));
  const blur = 6 / scale; // 不论缩放多少，屏幕上的模糊都保持在约 6px
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[-1] overflow-hidden rounded-[inherit]"
    >
      <div
        className="absolute inset-0"
        style={{
          background: hexToRgba(color, nodeMode === 4 ? 0.16 : 0.11),
          backdropFilter: `blur(${blur}px)`,
          WebkitBackdropFilter: `blur(${blur}px)`,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  FrostLayer —— 感知缩放的 <NodeFrost> 包装层。
 *
 *  只有绕过 / 禁用节点才渲染 <NodeFrost>，但以前**每个**画布节点都会订阅
 *  `useStore(state => state.transform[2])`，只为把 `zoom` 传下去 ——
 *  于是捏合 / 滚轮缩放会把 130 个节点全部重渲染，
 *  哪怕绝大多数根本不用毛玻璃。把缩放订阅挪到这个组件之后，
 *  就只有真的渲染毛玻璃层的节点会响应缩放变化
 *（它们的屏幕毛玻璃尺寸必须跟随视口），普通节点在缩放时纹丝不动。
 * ------------------------------------------------------------------------- */
export function FrostLayer({
  color,
  nodeMode,
}: {
  color: string | null;
  nodeMode: number;
}) {
  const zoom = useStore((state) => state.transform[2]);
  return <NodeFrost zoom={zoom} color={color} nodeMode={nodeMode} />;
}

/* ---------------------------------------------------------------------------
 *  StringTextarea —— 给长 STRING 控件（提示词、说明文字 …）用的多行只读文本框。
 *  它用浏览器原生的可滚动 textarea 取代了旧的 `<div>`
 *（后者的 Tailwind 空白 / 溢出类在这一子树里编译不可靠），
 *  于是换行与滚动都能工作，且不依赖任何 class。
 *
 *  高度策略（完全纵向堆叠布局）：
 *    • 行用 `flex-col gap-1.5 flex-1` —— 标签行在上，
 *      这个容器占满下方剩余空间。
 *    • 节点有固定框（`hasSize`）时，由 CSS 的 `flex-1 min-h-0` 链条处理高度：
 *      框高固定，控件区用 flex-1 拿走「框减去头部与主体行」的剩余空间，
 *      这个 textarea 再占 STRING 行的那一份。
 *      `maxHeight` 是**有意移除**的（以前是 96px），好让 12 行的提示词
 *      占满整个 STRING 行槽位，而不是被限高、悄悄躲在布局后面滚动。
 *      溢出内容在这个固定框内原生滚动。
 *    • 节点高度随内容（没有固定框）时，useLayoutEffect 把 textarea 的高度
 *      设成不限幅的 `scrollHeight`，好让 12 行提示词把这一行撑到能显示每一行
 *      —— 填充意图与 `flex-1` 链条相同，只是由 JS 而不是 CSS 驱动。 */

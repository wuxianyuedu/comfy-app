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
export const PSEUDO_FROST_BLOBS: Array<{
  alphaKey: "primary" | "secondary" | "cool" | "warm" | "shadow";
  blurPx: number;
  h: string;
  left: string;
  top: string;
  w: string;
}> = [
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
  if (!modeColor) {
    return null;
  }
  const palette = pseudoFrostPalette(modeColor);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
      style={{ zIndex: Z.base }}
    >
      {PSEUDO_FROST_BLOBS.map((blob, idx) => (
        <div
          className="absolute rounded-full"
          key={`blob-${idx}`}
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

/* NodeFrost —— 绕过/禁用节点用的真·透视毛玻璃层（backdrop-filter 模糊真实画布）。
 * Chromium 经典 bug：backdrop-filter 在屏幕占位极小的元素上会重铺平铺，缩小时出现 2²/3²/4² 重影。
 * 修法：按 1/zoom 反向缩放模糊元素，使屏幕占位保持 zoom=1 尺寸；外层 overflow:hidden 裁回节点边界，
 * 模糊半径除以同一比例，各缩放档有效屏幕模糊约 6px。 */
export function NodeFrost({
  zoom,
  color,
  nodeMode,
}: {
  color: string | null;
  nodeMode: number;
  zoom: number;
}) {
  if (!color || nodeMode === 0) {
    return null;
  }
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

/* FrostLayer —— 感知缩放的 <NodeFrost> 包装层。
 * 此前每个节点都订阅 `transform[2]` 只为传 zoom，捏合/滚轮会让上百节点全部重渲染。
 * 把缩放订阅挪到这一层后，只有真的渲染毛玻璃的节点响应缩放，普通节点纹丝不动。 */
export function FrostLayer({ color, nodeMode }: { color: string | null; nodeMode: number }) {
  const zoom = useStore((state) => state.transform[2]);
  return <NodeFrost color={color} nodeMode={nodeMode} zoom={zoom} />;
}

/* StringTextarea —— 长 STRING 控件的多行只读文本框：用原生可滚动 textarea 取代旧的 <div>
 *（Tailwind 空白/溢出类在该子树编译不可靠），换行与滚动不依赖 class。
 * 高度：固定框（hasSize）走 `flex-col gap-1.5 flex-1` + `flex-1 min-h-0`，maxHeight 有意移除（曾 96px），
 * 让 12 行提示占满 STRING 行并在框内原生滚动；无固定框时 useLayoutEffect 设高度为 scrollHeight。 */

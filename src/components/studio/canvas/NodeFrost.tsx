"use client";
import { Z } from "~/lib/shell/overlay-z";
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
  if (modeColor === null || modeColor === "") {
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

/* NodeFrost —— 旁路 / 停用节点的模式着色层。
 *
 * ⚠️ 这一版**不再透采画布**（ISSUE #4578 补充）：旧实现用 backdrop-filter
 * 模糊真实画布，而悬停抬层（ISSUE #400 的 z-index 提升）会改变节点在层叠序里
 * 的位置 —— 毛玻璃取样到的背影随之改变，节点颜色跟着悬停漂移（用户实测：
 * 同一节点悬停前后色值不同）。现在卡片本体已铺**不透明**的角色底色
 * （`palette.nodeBgOpaque`，见 WorkflowNode），本层只负责把模式色叠上去，
 * 颜色与层叠序彻底解耦：悬停、选中、邻点遮挡都不再改变它的色值。 */
export function NodeFrost({ color, nodeMode }: { color: string | null; nodeMode: number }) {
  if (color === null || color === "" || nodeMode === 0) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[-1] overflow-hidden rounded-[inherit]"
      data-testid="node-frost"
    >
      <div
        className="absolute inset-0"
        style={{ background: hexToRgba(color, nodeMode === 4 ? 0.16 : 0.11) }}
      />
    </div>
  );
}

/* FrostLayer —— <NodeFrost> 的接线层。旧版在这里订阅画布缩放
 * （backdrop-filter 的补偿参数）；着色层不再透采画布后没有可补偿的量，
 * 订阅随之撤除 —— 缩放不再触发磨砂节点重渲染。 */
export function FrostLayer({ color, nodeMode }: { color: string | null; nodeMode: number }) {
  return <NodeFrost color={color} nodeMode={nodeMode} />;
}

/* StringTextarea —— 长 STRING 控件的多行只读文本框：用原生可滚动 textarea 取代旧的 <div>
 *（Tailwind 空白/溢出类在该子树编译不可靠），换行与滚动不依赖 class。
 * 高度：固定框（hasSize）走 `flex-col gap-1.5 flex-1` + `flex-1 min-h-0`，maxHeight 有意移除（曾 96px），
 * 让 12 行提示占满 STRING 行并在框内原生滚动；无固定框时 useLayoutEffect 设高度为 scrollHeight。 */

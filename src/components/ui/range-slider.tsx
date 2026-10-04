"use client";

import { Slider } from "~/components/ui/slider";

/**
 * RangeSlider —— 项目内单值滑块的**唯一入口**（规范 16 §16.2.3 同族判据）。
 *
 * 定位：`~/components/ui/slider`（shadcn 官方 Slider、base-ui 版）的薄封装，
 * 把「单值受控 + `onChange` 拿 number」这一常见形态收在一处。消费点
 * （`CanvasSettingsPanel` 的 SliderRow）
 * 只用 `value / min / max / step / onChange / className`，本件的 props
 * 就是这些 + `id / disabled / aria-*` 三件透传。
 *
 * ## P67 治理（§16.2.3 / §12.18，跟进 PR-4 之后清零 8/8 的最后一步）
 *
 * 此前本件**用原生 `<input type="range">` 自绘渐变背景**（P67 c 判据的
 * 锚点形态）。文件头历史注释解释过不用 `ui/slider` 的**理由**是「换控件
 * 会动 DOM / 交互 / 快照测试」——但 §12.18 明确「改动代价大」**不是**
 * 「这一处独有的业务」的合法理由：原生 range 与 base-ui Slider 承担
 * 完全一样的业务（单值滑块），差异只在 DOM 结构与交互实现，而 base-ui
 * Slider 恰恰把这些代给了**更好的键盘/拖拽/a11y 契约**：
 *
 *   · 原生 `<input type="range">` 是浏览器 OS 级控件——深色主题下
 *     track/thumb 样式跨浏览器不一致（`accent-color` 在 WebKit 只染
 *     已填充段与滑块），读屏器读的是 OS 播报、样式与语义都不在项目
 *     控制内；
 *   · base-ui Slider 是纯 DOM 组件，默认带 `role="slider"` +
 *     `aria-valuenow/min/max` + 键盘 ←/→ / PageUp/PageDown / Home/End
 *     支持，样式走项目 token（`bg-muted` track + `bg-primary`
 *     indicator + ring focus）。
 *
 * 迁移策略：**props 外部 API 完全不变**（`value` / `min` / `max` /
 * `step` / `onChange` / `className` 逐字对齐），消费点 0 改动。内部把
 * 「自绘渐变 + 手挂 input 属性」换成 `<Slider>`：`value` 包一层
 * `[value]`（base-ui Slider 用数组表达多把手、单把手是长度 1 的数组
 * ——shadcn wrapper 里的 `_values.length` 判据依赖这个长度渲染 Thumb
 * 数量）、`onValueChange` 解一层数组回 number。
 *
 * 顺带**收窄 props 类型**：老实现 `extends OmitOwnProps<
 * React.ComponentProps<"input">, OWN_PROPS>` 允许任意 HTML input 属性
 * 透传（`name` / `form` / `pattern` 等），但 base-ui Slider 不吃这些
 * 原生 input 属性。实测两处消费点只用了 `value / min / max / step /
 * onChange / className`，把接口显式列出来更贴合实际用法（§12.18 复用
 * 优先 · 不为「可能有别的用法」预留未验证的透传面）。`id / disabled /
 * aria-label / aria-labelledby` 是 a11y 与测试定位必需、一并留下；如果
 * 后续真要透传更多字段，直接扩 `SliderPrimitive.Root.Props` 上的具体项。
 *
 * 快照：消费方的 `.snap` 会跟着更新 DOM 结构
 * （`<input type="range">` → base-ui Slider 的 `slider / slider-control
 * / slider-track / slider-range / slider-thumb` 五层）—— 这是**预期**的
 * 快照漂移、不是回归，用 `pnpm exec vitest run -u` 更新。
 */
export interface RangeSliderProps {
  /** 当前值（受控）。 */
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 取新值（已换算成 number）。 */
  onChange: (value: number) => void;
  /** 轨道额外类名（shadcn Slider 是 `data-horizontal:w-full`，一般不用给）。 */
  className?: string;
  /** DOM id（给 label `htmlFor` / Playwright 定位用）。 */
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  ...rest
}: RangeSliderProps) {
  return (
    <Slider
      /* base-ui Slider 的 value 是数组（多把手）；单把手用长度 1 的数组，
       * 这也是 shadcn wrapper 里 `_values.length` 判据用来渲染 Thumb 数量
       * 的根据——不能传裸 number，否则走 `[min, max]` 兜底变双把手。 */
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v: number | readonly number[]) => {
        /* shadcn 官方 `<Slider>` 的 wrapper 不转发 base-ui Slider 的 `Value`
         * 泛型,onValueChange 回调参数在 TS 侧被推成 `any`——这里显式标
         * `number | readonly number[]` 与 base-ui 内部约定**完全一致**
         * (base-ui Slider 全程用 `readonly number[]`,标 mutable 会在
         * contravariance 下报「Type 'readonly number[]' is not
         * assignable to 'number[]'」)。
         * **判据用 `typeof v === "number"` 而不是 `Array.isArray(v)`**:
         * Array.isArray 对 `readonly T[]` 的 narrow 在部分 TS / eslint
         * parser 版本组合里不收窄、`v[0]` 会被推成 any 触发
         * `no-unsafe-assignment`(实测本仓库 eslint v10 + @typescript-eslint
         * 场景);反过来用 `typeof v === "number"` 把 number 分支先剥掉,
         * else 分支里 v 会被 narrow 成 `readonly number[]`、`v[0]` 在
         * noUncheckedIndexedAccess 下是 `number | undefined`,由
         * `typeof n === "number"` 再兜底 narrow。单把手场景 v 恒为长度
         * 1 的数组、不会拿到 undefined;判据只是把 TS 契约钉严。 */
        const n = typeof v === "number" ? v : v[0];
        if (typeof n === "number") onChange(n);
      }}
      className={className}
      {...rest}
    />
  );
}

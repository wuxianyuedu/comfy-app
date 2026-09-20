"use client";

import { useId, type ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * FormField —— 「标签 + 控件 + 校验错误」这一行的唯一出口
 * （规范 16 §16.2.4.26）。
 *
 * 为什么收口：全库有 **15 处**各写一份「一行表单」，三件套一样、**四套度量
 * 语言**：
 *
 * | 落点 | 标签类 | 错误行 |
 * | --- | --- | --- |
 * | 设置页（`UsageTestDialog` / `RemoteModelDialog` / `LlmLocalSection` / `SettingsPrimitives`） | `text-ink/80 mb-1.5 block text-sm font-medium` | 字段错误挂在控件下方 |
 * | 训练工作室 | `mb-1.5 block text-[11px] font-medium text-ink-faint` | **只有一条整表错误**，不落字段 |
 * | 工作流导入面板 | `text-ink-soft mb-1 block text-xs font-medium` | 无 |
 * | 工坊模型适配弹窗 | `text-muted-foreground mb-1 block text-[10px]` | 无 |
 *
 * 而**真正的病灶不是字号不一致**，是三件事在不同落点被漏掉：
 *
 * 1. **`htmlFor` / `id` 关联** —— 15 处里**没有一处**把 `<label>` 与控件关联
 *    起来（设置页的 label 全是裸 `<label>`，点标签不聚焦输入框；读屏器把标签
 *    读成孤立文本）。表单行不只要「长得像」，还要「点得上、读得出」。
 * 2. **`aria-invalid` + `aria-describedby`** —— 错误文案渲染出来了，但**没有
 *    一处**把控件标记成无效、也没有一处把错误文案的 id 关联给控件：读屏器
 *    完全不知道「这个输入框现在是错的、错在哪」。设置页只有
 *    `RemoteModelDialog` 的模型名一栏写了 `aria-invalid`（占全部字段的 1/15）。
 * 3. **错误行必须给用户看得见的位置**（硬规则 4）—— 训练工作室那条整表错误
 *    挂在提交按钮上方，用户改了下面某一行也**没有任何标记**指出是哪一行错
 *    （`validateTrainForm` 明明返回的是逐字段判据，却只在末尾报一句）。
 *
 * ## 三件本组件一次给全的事
 *
 * 1. **`htmlFor` 由 `id` 派生**（`useId` 兜底），点标签即聚焦控件；
 * 2. **错误态自动上 `aria-invalid` 与 `aria-describedby`** —— 这两个属性由
 *    `error` 的存在性决定，调用处**不可能**忘记其中一个（此前正是「写了
 *    `aria-invalid` 却忘了关联错误文案」）；
 * 3. **错误行有稳定 id**，与 `aria-describedby` 同源（改名不会漏一处）。
 *
 * ## 它不做的事
 *
 * - **不接管控件**：`children` 是任意节点（`Input` / `SelectMenu` / 自定义
 *   复合控件都行）。要拿到 `aria-invalid` 等 ARIA 属性，用 render-prop 形式
 *   的 `children`（`(a11y) => <Input {...a11y} />`）—— 硬包一层 `<Input>`
 *   会把 `SelectMenu` 这类非 input 控件挡在门外。
 * - **不判校验**：字段级规则住在 `~/lib/<domain>/*-schema.ts` 的纯函数里
 *   （§16.2.4.8），集合级规则住在 controller。本组件只负责**把结果渲染出来**。
 * - **不管布局**：整行的外边距由调用处给（`className`）；本组件只管行**内部**
 *   的标签 / 控件 / 错误三件的位置关系。
 */
export interface FormFieldA11y {
  /** 控件的 `id`（给 `htmlFor` 用）。 */
  id: string;
  /** 有错误时才有：`true`。 */
  "aria-invalid"?: true;
  /** 有错误时才有：错误行的 `id`。 */
  "aria-describedby"?: string;
}

export function FormField({
  label,
  id,
  error,
  hint,
  required,
  children,
  className,
  labelClassName,
  errorClassName,
}: {
  /** 标签文案。给 `null` 时不渲染标签行（但**要**保留 `aria-label` 就自己加）。 */
  label: ReactNode;
  /**
   * 控件的 `id`。不给则由 `useId` 生成 —— 生成的那份只在**没有** `htmlFor`
   * 关联价值时才可接受（如标签行只是装饰），多数调用处应显式给一个稳定 id
   * （E2E 与 Playwright 也按它定位）。
   */
  id?: string;
  /** 字段级错误文案。给了才渲染错误行并自动上 ARIA。 */
  error?: string | null;
  /** 常驻说明（`<p>` 挂在控件下方），位于错误行**之上** —— 错误更靠下、更靠
   *  近下一次交互，符合「先解释、再报错」的阅读顺序。 */
  hint?: ReactNode;
  /** 是否必填：标签右侧给一个 `*`（无错误时的静态标记）。 */
  required?: boolean;
  /**
   * 控件。给函数时收到 `{ id, aria-invalid, aria-describedby }`。
   * **可省略** —— 行编辑器这类「标签 + 说明文字，控件在别处」的落点
   * 只用一个带 `hint` 的标签行即可（不省略就得写 `children={<></>}`）。
   */
  children?: ReactNode | ((a11y: FormFieldA11y) => ReactNode);
  className?: string;
  labelClassName?: string;
  errorClassName?: string;
}) {
  /* `useId` 不能有条件调用，所以无条件取一次；`id` 给了就用给的。
   * `useId` 的产物含 `:`（React 19 起是 `«r0»` 之类），直接当 DOM id 是合法的，
   * 但不能拿去做 CSS 选择器 —— 本组件只把它交给 `htmlFor` / `aria-*`。 */
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = error ? `${fieldId}-error` : undefined;

  const a11y: FormFieldA11y = {
    id: fieldId,
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(errorId ? { "aria-describedby": errorId } : {}),
  };

  return (
    <div className={cn("min-w-0", className)}>
      {label != null && (
        <label
          htmlFor={fieldId}
          className={cn(
            "text-ink/80 mb-1.5 block text-sm font-medium",
            labelClassName,
          )}
        >
          {label}
          {required && (
            <span className="text-danger-strong ml-0.5" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {typeof children === "function" ? children(a11y) : (children ?? null)}
      {hint != null && (
        <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
          {hint}
        </p>
      )}
      {error != null && error !== "" && (
        <p
          id={errorId}
          className={cn("text-danger-strong mt-1 text-[11px]", errorClassName)}
        >
          {error}
        </p>
      )}
    </div>
  );
}

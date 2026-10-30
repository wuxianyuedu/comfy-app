"use client";

/**
 * 外观主题分区（规范 17 §17.2 第③层）：深色 / 浅色二选一，切换即保存。
 *
 * 纯展示：只消费 controller 的 `theme` 与 `setTheme`。
 */

import { useEffect, useState } from "react";

import { Moon, Sun } from "lucide-react";

import { Button } from "~/components/ui/button";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  DEFAULT_APPEARANCE,
  FONT_SCALE_STEPS,
  RADIUS_STEPS,
  readAppearance,
  saveAppearance,
  type AppearancePrefs,
  type AppearanceStep,
} from "~/lib/appearance";

import { SettingsCard } from "~/components/ui/settings-card";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

export function AppearanceSection({ c }: { c: ReadySettingsPageController }) {
  /* 已保存的外观偏好。读取放在挂载之后：localStorage 在 SSR 阶段不存在，直接当
     useState 初值会让服务端与首帧不一致（选中态跳变）。 */
  const [prefs, setPrefs] = useState<AppearancePrefs>(DEFAULT_APPEARANCE);
  const [notPersisted, setNotPersisted] = useState(false);
  useEffect(() => {
    /* 延到提交之后（与 `TopBar` / `workspace/page.tsx` 同一做法）：effect 体内同步
       setState 会触发级联渲染。 */
    const t = setTimeout(() => setPrefs(readAppearance()), 0);
    return () => clearTimeout(t);
  }, []);

  const update = (patch: Partial<AppearancePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    /* 写不进存储（隐私模式等）时变量仍然生效，只是下次打开回到默认 ——
       这件事必须让用户看见，不能静默。 */
    setNotPersisted(!saveAppearance(next));
  };

  return (
    <SettingsCard title="外观主题">
      <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
        选择应用的主题外观：深色（Dark）或浅色（Light）。切换即时生效并自动保存，
        也可通过顶部导航栏的太阳/月亮按钮随时切换。
      </p>
      {/* `role="radiogroup"` / `role="radio"` 由 `RadioGroup` 基元下发 —— 不手写：
          手写只给了「读屏知道这是个单选组」，**方向键契约没人给**（本批之前
          这两处正是「能聚焦、Tab 进得来、但组内方向键没反应」）。基元同时
          负责 roving tabindex（组内只有选中项 `tabIndex=0`）与
          ArrowUp/Down/Left/Right 的「移动 + 选中」。

          **选中档必须自带与常态同值的 `data-checked:hover:`**（规范 16
          §16.2.4.75）。这三组（主题卡 + 圆角 + 标题字阶）底部都是
          `Button variant="ghost"`，而 `ghost` 自带 `hover:bg-muted
          hover:text-foreground` —— 它是**无条件的**。选中档此前只钉了
          `data-checked:bg-primary-soft` / `data-checked:text-*`，**没钉悬停值**，
          于是划过**已选中**的那一枚时被 `hover:` 改写：「选中」在悬停期间变回
          「未选中」。这不是特异性问题里的偶然 —— `data-checked:*` 编译出的选择器
          是 `.data-checked\:bg-primary-soft:where([data-state=checked])`，
          `:where()` **零特异性** ⇒ `(0,1,0)`，而 `hover:bg-muted` 是 `(0,2,0)`，
          悬停档稳赢。`ui/select-chip` 当初就是为这件事把
          `aria-checked:hover:bg-primary-soft` 写死的。
          修法**就地钉**而不是换 `SelectChip`：这三组的单选语义与方向键契约由
          `RadioGroup` 基元给，换成 `SelectChip`（自有 `role="radio"` + 手搓
          roving）会把这条契约丢掉。 */}
      <RadioGroup
        aria-label="主题外观"
        value={c.theme}
        onValueChange={(v) => c.setTheme(/* SAFETY: 类型断言已复核 */ v as "dark" | "light")}
        className="grid max-w-md grid-cols-2 gap-3"
      >
        {
          /* SAFETY: 类型断言已复核 */ (
            [
              {
                value: "dark",
                label: "深色",
                Icon: Moon,
                hint: "适合低光环境",
              },
              {
                value: "light",
                label: "浅色",
                Icon: Sun,
                hint: "明亮、高对比",
              },
            ] as const
          ).map(({ value, label, Icon, hint }) => (
            <RadioGroupItem
              key={value}
              value={value}
              /* 主题卡是「整卡可点」的选项，不是动作按钮：基元的尺寸/高度/内边距/
               字号全部归还给调用处 —— 基类是「小圆点」形态（`size-4` +
               `aspect-square`），这里必须连**宽度**与**宽高比**一起还
               （`size-auto!` / `aspect-auto!`；只还 `h-auto` 的话宽度仍是 16px，
               卡片被压成竖排单字、内容溢出叠到下一节）。
               基元自带的「中心圆点」选中指示器是给小圆点形态用的；这里选中态
               已由边框 + 底色表达，圆点只会叠在文字上，隐藏（见下一条同款）。 */
              nativeButton
              render={
                <Button
                  variant="ghost"
                  className="data-checked:border-primary data-checked:bg-primary-soft data-checked:text-ink data-checked:hover:border-primary data-checked:hover:bg-primary-soft data-checked:hover:text-ink data-unchecked:border-border data-unchecked:bg-surface-1 data-unchecked:text-muted-foreground data-unchecked:hover:border-border-strong data-unchecked:hover:text-ink aspect-auto! size-auto! flex-col items-start justify-start gap-1.5 rounded-xl border p-4 text-left whitespace-normal transition-colors **:data-[slot=radio-group-indicator]:hidden"
                />
              }
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={18} className="text-primary" />
                {label}
              </span>
              <span className="text-xs opacity-80">{hint}</span>
            </RadioGroupItem>
          ))
        }
      </RadioGroup>

      {/* 圆角与标题字阶各只改一个全局 CSS 变量（--radius / --font-scale）；
          具体数值留在 globals.css 一处，这里不重复定义基准。 */}
      <StepRow
        label="圆角"
        hint="影响卡片、按钮、输入框等所有圆角。"
        steps={RADIUS_STEPS}
        value={prefs.radius}
        onChange={(id) => update({ radius: id })}
      />
      <StepRow
        label="标题字阶"
        hint="只影响各级标题；正文与小号文字保持原尺寸，不随这一档变化。"
        steps={FONT_SCALE_STEPS}
        value={prefs.fontScale}
        onChange={(id) => update({ fontScale: id })}
      />
      {notPersisted && (
        <p className="text-warning mt-3 text-xs">
          浏览器拒绝了本地存储：本次设置立即生效，但下次打开会回到默认值。
        </p>
      )}
    </SettingsCard>
  );
}

/** 一横向的可选档位（沿用主题那排的 radiogroup 语义，只是尺寸收紧）。 */
function StepRow({
  label,
  hint,
  steps,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  steps: Array<AppearanceStep>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-ink text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </div>
      {/* 同主题卡：单选组的方向键契约由 `RadioGroup` 基元给（见上面那段注释）。 */}
      <RadioGroup
        aria-label={label}
        value={value}
        onValueChange={onChange}
        className="flex flex-wrap gap-2"
      >
        {steps.map((step) => (
          <RadioGroupItem
            key={step.id}
            value={step.id}
            nativeButton
            render={
              <Button
                variant="ghost"
                size="sm"
                /* 同主题卡：小圆点选中指示器在药丸形态只会叠在文字上，隐藏。 */
                className="data-checked:border-primary data-checked:bg-primary-soft data-checked:text-primary data-checked:hover:border-primary data-checked:hover:bg-primary-soft data-checked:hover:text-primary data-unchecked:border-border data-unchecked:text-muted-foreground data-unchecked:hover:border-border-strong data-unchecked:hover:text-ink aspect-auto! size-auto! rounded-lg border px-3 py-1.5 text-xs **:data-[slot=radio-group-indicator]:hidden"
              />
            }
          >
            {step.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}

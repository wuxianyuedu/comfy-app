"use client";

/**
 * 外观主题分区（规范 17 §17.2 第③层）：深色 / 浅色二选一，切换即保存。
 *
 * 纯展示：只消费 controller 的 `theme` 与 `setTheme`。
 */

import { useEffect, useState } from "react";

import { Moon, Sun } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useFilePicker } from "~/components/ui/file-picker";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_CODE_FONT,
  DEFAULT_INTERFACE_FONT,
  DEFAULT_TERMINAL_FONT,
  FONT_SCALE_STEPS,
  RADIUS_STEPS,
  readAppearance,
  registerUserFont,
  saveAppearance,
  type AppearancePrefs,
  type AppearanceStep,
  type FontTier,
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
    const t = setTimeout(() => {
      setPrefs(readAppearance());
    }, 0);
    return () => {
      clearTimeout(t);
    };
  }, []);

  const update = (patch: Partial<AppearancePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    /* 写不进存储（隐私模式等）时变量仍然生效，只是下次打开回到默认 ——
       这件事必须让用户看见，不能静默。 */
    setNotPersisted(!saveAppearance(next));
  };

  return (
    /* SAFETY: 类型断言已复核 */
    <SettingsCard>
      <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
        选择应用的主题外观：深色（Dark）或浅色（Light）。切换即时生效并自动保存，
        也可通过顶部导航栏的太阳/月亮按钮随时切换。
      </p>
      {/* role/方向键契约/roving tabindex 由 `RadioGroup` 基元下发，不手写。
          选中档必须自带与常态同值的 `data-checked:hover:`（规范 16 §16.2.4.75）：
          `data-checked:*` 经 `:where()` 是零特异性 (0,1,0)，输给 `ghost` 无条件的
          `hover:bg-muted` (0,2,0)，已选中项悬停会被改回「未选中」。
          修法就地钉而不是换 `SelectChip`：那会丢掉 RadioGroup 的方向键契约。 */}
      <RadioGroup
        aria-label="主题外观"
        className="grid max-w-md grid-cols-2 gap-3"
        onValueChange={(raw) => {
          /* 基元的 `onValueChange` 出参是 `any`：先落 `unknown`，再按字面量收窄。 */
          const v: unknown = raw;
          if (v === "dark" || v === "light") {
            c.setTheme(v);
          }
        }}
        value={c.theme}
      >
        {(
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
            /* 整卡可点选项：基元尺寸全部归还调用处 —— 基类是小圆点形态（`size-4`+`aspect-square`），
               必须连宽度与宽高比一起还（`size-auto!`/`aspect-auto!`），否则宽度仍 16px、卡片被压竖排。
               基元的中心圆点指示器是小圆点形态用的；此处选中态已由边框+底色表达，圆点隐藏
               （选中实心底自 ISSUE #3553 起已下沉到 Indicator 层，卡片形态不再被基元根的
               `data-checked:bg-primary` 填紫，调用方无需再写覆盖 hack）。 */
            nativeButton
            render={
              <Button
                className="data-checked:border-primary data-checked:bg-primary-soft data-checked:text-ink data-checked:hover:border-primary data-checked:hover:bg-primary-soft data-checked:hover:text-ink data-unchecked:border-border data-unchecked:bg-surface-row data-unchecked:text-muted-foreground data-unchecked:hover:border-border-strong data-unchecked:hover:text-ink aspect-auto! size-auto! flex-col items-start justify-start gap-1.5 rounded-xl border p-4 text-left whitespace-normal transition-colors **:data-[slot=radio-group-indicator]:hidden"
                variant="ghost"
              />
            }
            value={value}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Icon className="text-primary" size={18} />
              {label}
            </span>
            <span className="text-xs opacity-80">{hint}</span>
          </RadioGroupItem>
        ))}
      </RadioGroup>

      {/* 圆角与标题字阶各只改一个全局 CSS 变量（--radius / --font-scale）；
          具体数值留在 globals.css 一处，这里不重复定义基准。 */}
      <StepRow
        hint="影响卡片、按钮、输入框等所有圆角。"
        label="圆角"
        onChange={(id) => {
          update({ radius: id });
        }}
        steps={RADIUS_STEPS}
        value={prefs.radius}
      />
      <StepRow
        hint="只影响各级标题；正文与小号文字保持原尺寸，不随这一档变化。"
        label="标题字阶"
        onChange={(id) => {
          update({ fontScale: id });
        }}
        steps={FONT_SCALE_STEPS}
        value={prefs.fontScale}
      />

      {/* 字体三档是自由字符串（非预置档位）：用文本输入框，不进 radiogroup ——
          既贴合「可填任意字体栈」的语义，也不破坏「恰好三个 radiogroup」的契约
          （AppearanceSection.test.tsx 锚定 ["主题外观", "圆角", "标题字阶"]）。
          每档各带「恢复默认」：把该档回落到 globals.css 的原值。 */}
      <FontRow
        hint="自定义整个界面使用的字体（正文与界面文字）。"
        label="界面字体"
        onChange={(value) => {
          update({ interfaceFont: value });
        }}
        onReset={() => {
          update({ interfaceFont: DEFAULT_INTERFACE_FONT });
        }}
        tier="interface"
        value={prefs.interfaceFont}
      />
      <FontRow
        hint="自定义代码块使用的字体。"
        label="代码字体"
        onChange={(value) => {
          update({ codeFont: value });
        }}
        onReset={() => {
          update({ codeFont: DEFAULT_CODE_FONT });
        }}
        tier="code"
        value={prefs.codeFont}
      />
      <FontRow
        hint="自定义终端使用的字体（等宽展示）。"
        label="终端字体"
        onChange={(value) => {
          update({ terminalFont: value });
        }}
        onReset={() => {
          update({ terminalFont: DEFAULT_TERMINAL_FONT });
        }}
        tier="terminal"
        value={prefs.terminalFont}
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
  hint: string;
  label: string;
  onChange: (id: string) => void;
  steps: Array<AppearanceStep>;
  value: string;
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
        className="flex flex-wrap gap-2"
        onValueChange={onChange}
        value={value}
      >
        {steps.map((step) => (
          <RadioGroupItem
            key={step.id}
            nativeButton
            render={
              <Button
                /* 同主题卡：小圆点选中指示器在药丸形态只会叠在文字上，隐藏。 */
                className="data-checked:border-primary data-checked:bg-primary-soft data-checked:text-primary data-checked:hover:border-primary data-checked:hover:bg-primary-soft data-checked:hover:text-primary data-unchecked:border-border data-unchecked:text-muted-foreground data-unchecked:hover:border-border-strong data-unchecked:hover:text-ink aspect-auto! size-auto! rounded-lg border px-3 py-1.5 text-xs **:data-[slot=radio-group-indicator]:hidden"
                size="sm"
                variant="ghost"
              />
            }
            value={step.id}
          >
            {step.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}

/** 一档字体：文本输入框 + 恢复默认 + 运行时字体文件加载器。自由字符串档既可在
 *  文本框里填系统字体名，也可通过 `FontFileLoader` 拖入 / 选择字体文件让本机未装的
 *  字体也能用（`FontFace` 注册 + IndexedDB 持久化）。 */
function FontRow({
  label,
  hint,
  value,
  onChange,
  onReset,
  tier,
}: {
  hint: string;
  label: string;
  onChange: (value: string) => void;
  onReset: () => void;
  tier: FontTier;
  value: string;
}) {
  /* 输入框的 aria-label 直接用档名，读屏用户也能定位到「界面字体」这一格；
     恢复默认按钮同样带可读名，方向键之外也能操作。 */
  const inputId = `font-${label}`;
  return (
    <div className="mt-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <label className="text-ink text-sm font-semibold" htmlFor={inputId}>
          {label}
        </label>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          className="max-w-md"
          id={inputId}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          placeholder="例如 Inter / IBM Plex Mono"
          value={value}
        />
        <Button
          aria-label={`${label}恢复默认`}
          className="shrink-0"
          onClick={onReset}
          size="sm"
          variant="outline"
        >
          恢复默认
        </Button>
      </div>
      <FontFileLoader onChange={onChange} tier={tier} />
    </div>
  );
}

/** 一档字体的运行时替换入口：拖入或选择 `.ttf` / `.otf` / `.woff` / `.woff2` 文件，
 *  经 `registerUserFont` 把字形注册进文档并持久化，再把生成的字体栈写回对应档。
 *  视图层只负责「拿到 File」，文件 IO 与 `FontFace` 注册在 `~/lib/appearance` 里。 */
function FontFileLoader({ onChange, tier }: { onChange: (value: string) => void; tier: FontTier }) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const { stack } = await registerUserFont(file, tier);
      onChange(stack);
    } catch {
      setError("字体文件无法加载，请换一个 .ttf / .otf / .woff / .woff2 文件。");
    } finally {
      setBusy(false);
    }
  };
  const picker = useFilePicker({
    accept: ".ttf,.otf,.woff,.woff2",
    onPick: (file) => {
      void handleFile(file);
    },
  });
  return (
    <div className="mt-2">
      <div
        className={
          dragOver
            ? "border-primary bg-primary-soft/40 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs"
            : "border-border flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs"
        }
        onDragLeave={() => {
          setDragOver(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer?.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      >
        <span className="text-muted-foreground">拖入字体文件，或</span>
        <Button disabled={busy} onClick={picker.open} size="sm" variant="outline">
          {busy ? "加载中…" : "选择文件"}
        </Button>
        <picker.Input />
      </div>
      {error ? <p className="text-danger-strong mt-1 text-xs">{error}</p> : null}
    </div>
  );
}

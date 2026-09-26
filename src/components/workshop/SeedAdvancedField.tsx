"use client";

// 工坊生成表单的「高级 · 种子」控件（Phase 8 · P8-1c）。
//
// 种子是高级输入：默认留空 = 每次生成自动取一个新随机 seed（配合工作流连了「种子」口才真正生效，
// 没连则落不下去、用工作流图内 seed）。用户可填一个固定数字来 pin 住种子（复现同一张图），或点
// 「随机」清空回到自动随机。折叠用官方 `Disclosure`（P10），输入用官方 `Input`（P68）。
import { Dices } from "lucide-react";

import { Disclosure } from "~/components/ui/disclosure";
import { Hint } from "~/components/ui/hint";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { textHandler } from "~/lib/form-props";

export interface SeedAdvancedFieldProps {
  /** 种子输入框的原始字符串；空串 = 自动随机。 */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SeedAdvancedField({
  value,
  onChange,
  disabled,
}: SeedAdvancedFieldProps) {
  return (
    <Disclosure
      marker="chevron"
      trigger={
        <span className="text-muted-foreground text-xs font-medium">高级</span>
      }
      className="px-1 py-0.5"
      panelClassName="mt-1"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground shrink-0">种子</span>
        <Input
          type="number"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={textHandler(onChange)}
          placeholder="留空＝每次随机"
          className="border-border bg-bg text-ink h-7 w-36 text-xs"
        />
        <Hint label="清空为自动随机" wrap>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => onChange("")}
            className="text-muted-foreground hover:text-ink h-7 gap-1 px-2"
          >
            <Dices size={13} />
            随机
          </Button>
        </Hint>
      </div>
    </Disclosure>
  );
}

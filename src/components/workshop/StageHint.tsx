"use client";

// 阶段前置温和提示条。纯展示：文案与跳转目标由调用方给，不阻断任何操作。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";

type StageHintProps = {
  onGo: () => void;
  text: string;
};

export function StageHint({ text, onGo }: StageHintProps) {
  return (
    <div className="bg-amber/10 text-amber mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs">
      <Icon className="shrink-0" name="info" size={13} />
      <span className="flex-1">{text}</span>
      <Button
        className="bg-amber/15 text-amber hover:bg-amber/25 font-medium"
        onClick={onGo}
        size="xs"
        type="button"
        variant="ghost"
      >
        去完成 →
      </Button>
    </div>
  );
}

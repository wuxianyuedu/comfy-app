"use client";

// ── 「模式契约」编辑器的参数库（规范 17 §17.2 第③层：只渲染 + 上抛）────────
// 两块：
// ① 全部预制口 —— **完整**一张表，已加入的标出来、没加入的点一下就加。
// 只列「还剩哪几个没加」会让作者以为「这套系统就支持这几样」（用户口径：
// 「也要能浏览有全部的参数」）；
// ② 自定义口 —— 作者自己声明的口（起名 + 选简单类型），可增可删可改名。
// 预制口就那么几类，往后想加一个新口不该再改代码。
//
// 本组件不持有契约状态：值从 props 来、动作往上抛（与编辑器其余部分同一条分层）。
//
// ── 本次改版（ISSUE #1423）：字号收敛 ──────────────────────────────────
// 改版前这一块整片是 `text-3xs`(10px) —— 说明行、chip 文案、类型章、id 全在
// 10–11px。现在：说明行 12px（`text-xs`），可点 chip 走 `ui/select-chip`
// 的 `compact` 档（11px `text-2xs`，微标签两档的上限），已加入的 chip 不再
// 靠「灰化」表达，而是**用选中态**表达（已在本契约里 = 选中）。

import { useState } from "react";
import { textHandler } from "~/lib/form-props";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { Input } from "~/components/ui/input";
import { SelectChip } from "~/components/ui/select-chip";
import { enterCommit } from "~/components/ui/use-enter-commit";
import type {
  ModeContractCustomInput,
  ModeContractCustomKind,
  ModeContractInputType,
} from "~/lib/workshop/model-mode-contract";

import {
  CUSTOM_INPUT_KINDS,
  contractInputCatalog,
  customInputKindLabel,
} from "../mode-contract-config";

type ContractInputCatalogProps = {
  /** 本契约的自定义口定义。 */
  customInputs: ReadonlyArray<ModeContractCustomInput>;
  /** 本契约已经有的口（判断「已添加」）。 */
  inputs: ReadonlyArray<string>;
  /** 新增一个自定义口（名 + 类型）。 */
  onAddCustom: (label: string, kind: ModeContractCustomKind) => void;
  /** 点一个预制口（`reference-image` 由调用方换成下一个参考图槽）。 */
  onAddPredefined: (type: ModeContractInputType) => void;
  /** 从契约里移除一个自定义口（定义一并移除）。 */
  onRemoveCustom: (id: ModeContractCustomInput["id"]) => void;
  /** 改一个自定义口的名字。 */
  onRenameCustom: (id: ModeContractCustomInput["id"], label: string) => void;
};

export function ContractInputCatalog({
  customInputs,
  inputs,
  onAddCustom,
  onAddPredefined,
  onRemoveCustom,
  onRenameCustom,
}: ContractInputCatalogProps) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<ModeContractCustomKind>("text");
  const catalog = contractInputCatalog(inputs);

  const submitCustom = () => {
    const name = draftName.trim();
    if (!name) {
      return;
    }
    onAddCustom(name, draftKind);
    setDraftName("");
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-muted-foreground mb-2 text-xs">
          全部可用参数（预制）—— 点未加入的即可添加
        </p>
        {/* 预制口是**可选的**一组：这里按 `role="group"` 给组名，
            每一枚的选中态说的是「它在本契约里」（与上面输入口清单同一件事的
            另一种入口）—— 同一份状态两个视图，`selected` 都从 `item.added` 来。 */}
        <div aria-label="预制参数" className="flex flex-wrap gap-1.5" role="group">
          {catalog.map((item) => (
            <Hint
              key={item.type}
              label={item.added ? "已在当前契约里" : `添加「${item.label}」到契约`}
              wrap
            >
              <SelectChip
                /* 已加入的保持选中态、**不置灰** —— 10px 灰字 + 40% 透明
                   是改版前它读起来像「坏了」而不是「已经在里面了」的原因。 */
                className="disabled:opacity-100"
                disabled={item.added}
                onClick={() => onAddPredefined(item.type)}
                selected={item.added}
                shape="compact"
              >
                {item.added ? "✓" : "＋"} {item.label}
              </SelectChip>
            </Hint>
          ))}
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs">
          自定义参数（自己起名 + 选类型）—— 预制的口不够用时加在这里
        </p>
        <div className="flex flex-col gap-1.5">
          {customInputs.map((def) => (
            <div
              className="border-border bg-surface flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
              key={def.id}
            >
              <Input
                aria-label={`${def.label} 的名称`}
                className="h-7 min-w-0 flex-1 border-none bg-transparent px-0 text-xs shadow-none"
                /* 非受控 + 失焦提交：逐键写回契约会让每次输入都触发一次保存态
                 * 重置，而空名中途是常态（用户先清空再改名）。 */
                defaultValue={def.label}
                onBlur={(event) => {
                  const next = event.currentTarget.value.trim();
                  if (next === "") {
                    event.currentTarget.value = def.label;
                    return;
                  }
                  if (next !== def.label) {
                    onRenameCustom(def.id, next);
                  }
                }}
              />
              <span className="text-muted-foreground bg-subtle border-border-strong text-2xs shrink-0 rounded border px-1.5 py-0.5">
                {customInputKindLabel(def.kind)}
              </span>
              <span className="text-muted-foreground/50 text-2xs shrink-0 font-mono">{def.id}</span>
              <Button
                aria-label={`删除自定义参数 ${def.label}`}
                className="text-muted-foreground/60 hover:text-danger-strong shrink-0"
                onClick={() => onRemoveCustom(def.id)}
                size="icon-sm"
                variant="ghost"
              >
                ✕
              </Button>
            </div>
          ))}

          {adding ? (
            <div className="border-primary-soft bg-primary-soft/20 flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2">
              <Input
                autoFocus
                onChange={textHandler(setDraftName)}
                value={draftName}
                /* Enter 提交 / Esc 取消走唯一实现（§16.2.4.29）：自己判键会漏掉
                 *`preventDefault` 与输入法组字态（中文拼音未上屏时的 Enter
                 * 是「确认候选」，不是提交）。 */
                {...enterCommit({
                  onCancel: () => setAdding(false),
                  onCommit: () => submitCustom(),
                })}
                aria-label="自定义参数名称"
                className="h-7 w-44 text-xs"
                placeholder="参数名称，如：水彩风格"
              />
              <div aria-label="参数类型" className="flex items-center gap-1.5" role="group">
                {CUSTOM_INPUT_KINDS.map((item) => (
                  <Hint key={item.kind} label={item.hint}>
                    <SelectChip
                      onClick={() => setDraftKind(item.kind)}
                      selected={draftKind === item.kind}
                      shape="compact"
                    >
                      {item.label}
                    </SelectChip>
                  </Hint>
                ))}
              </div>
              <Button
                className="h-7 rounded-lg px-3 text-xs"
                disabled={draftName.trim() === ""}
                onClick={submitCustom}
                size="xs"
                variant="primary-solid"
              >
                添加
              </Button>
              <Button
                className="text-muted-foreground h-7 rounded-lg px-2 text-xs"
                onClick={() => setAdding(false)}
                size="xs"
                variant="ghost"
              >
                取消
              </Button>
            </div>
          ) : (
            <SelectChip
              className="self-start px-2.5 py-1 text-xs"
              onClick={() => setAdding(true)}
              selected={false}
              shape="dashed"
            >
              ＋ 新增自定义参数
            </SelectChip>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// ── 「模式契约」编辑器的参数库（规范 17 §17.2 第③层：只渲染 + 上抛）────────
// 两块：
//   ① 全部预制口 —— **完整**一张表，已加入的标出来、没加入的点一下就加。
//      只列「还剩哪几个没加」会让作者以为「这套系统就支持这几样」（用户口径：
//      「也要能浏览有全部的参数」）；
//   ② 自定义口 —— 作者自己声明的口（起名 + 选简单类型），可增可删可改名。
//      预制口就那么几类，往后想加一个新口不该再改代码。
//
// 本组件不持有契约状态：值从 props 来、动作往上抛（与编辑器其余部分同一条分层）。

import { useState } from "react";
import { textHandler } from "~/lib/form-props";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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

interface ContractInputCatalogProps {
  /** 本契约已经有的口（判断「已添加」）。 */
  inputs: readonly string[];
  /** 本契约的自定义口定义。 */
  customInputs: readonly ModeContractCustomInput[];
  /** 点一个预制口（`reference-image` 由调用方换成下一个参考图槽）。 */
  onAddPredefined: (type: ModeContractInputType) => void;
  /** 新增一个自定义口（名 + 类型）。 */
  onAddCustom: (label: string, kind: ModeContractCustomKind) => void;
  /** 改一个自定义口的名字。 */
  onRenameCustom: (id: ModeContractCustomInput["id"], label: string) => void;
  /** 从契约里移除一个自定义口（定义一并移除）。 */
  onRemoveCustom: (id: ModeContractCustomInput["id"]) => void;
}

export function ContractInputCatalog({
  inputs,
  customInputs,
  onAddPredefined,
  onAddCustom,
  onRenameCustom,
  onRemoveCustom,
}: ContractInputCatalogProps) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<ModeContractCustomKind>("text");
  const catalog = contractInputCatalog(inputs);

  const submitCustom = () => {
    const name = draftName.trim();
    if (!name) return;
    onAddCustom(name, draftKind);
    setDraftName("");
    setAdding(false);
  };

  return (
    <div className="space-y-2">
      <div>
        <p className="text-muted-foreground mb-1 text-[10px]">
          全部可用参数（预制）—— 点未加入的即可添加
        </p>
        <div className="flex flex-wrap gap-1">
          {catalog.map((item) => (
            <Button
              key={item.type}
              variant="outline"
              size="xs"
              disabled={item.added}
              onClick={() => onAddPredefined(item.type)}
              title={
                item.added ? "已在当前契约里" : `添加「${item.label}」到契约`
              }
              className={`h-auto rounded border-dashed px-2 py-0.5 ${
                item.added
                  ? "border-border text-muted-foreground/60 cursor-default"
                  : "border-primary/40 text-primary hover:bg-primary/10"
              }`}
            >
              {item.added ? "✓" : "＋"} {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-1 text-[10px]">
          自定义参数（自己起名 + 选类型）—— 预制的口不够用时加在这里
        </p>
        <div className="space-y-1">
          {customInputs.map((def) => (
            <div
              key={def.id}
              className="border-border bg-surface flex items-center gap-1.5 rounded-lg border px-2 py-1"
            >
              <Input
                /* 非受控 + 失焦提交：逐键写回契约会让每次输入都触发一次保存态
                 *  重置，而空名中途是常态（用户先清空再改名）。 */
                defaultValue={def.label}
                onBlur={(event) => {
                  const next = event.currentTarget.value.trim();
                  if (next === "") {
                    event.currentTarget.value = def.label;
                    return;
                  }
                  if (next !== def.label) onRenameCustom(def.id, next);
                }}
                aria-label={`${def.label} 的名称`}
                className="h-6 min-w-0 flex-1 border-none bg-transparent px-0 text-[11px] shadow-none"
              />
              <span className="text-muted-foreground/70 bg-subtle border-border-strong shrink-0 rounded border px-1.5 py-0.5 text-[10px]">
                {customInputKindLabel(def.kind)}
              </span>
              <span className="text-muted-foreground/50 shrink-0 font-mono text-[10px]">
                {def.id}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRemoveCustom(def.id)}
                className="text-muted-foreground/60 hover:text-danger-strong shrink-0"
                aria-label={`删除自定义参数 ${def.label}`}
              >
                ✕
              </Button>
            </div>
          ))}

          {adding ? (
            <div className="border-primary-soft bg-primary-soft/20 flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
              <Input
                autoFocus
                value={draftName}
                onChange={textHandler(setDraftName)}
                /* Enter 提交 / Esc 取消走唯一实现（§16.2.4.29）：自己判键会漏掉
                 *  `preventDefault` 与输入法组字态（中文拼音未上屏时的 Enter
                 *  是「确认候选」，不是提交）。 */
                {...enterCommit({
                  onCommit: () => submitCustom(),
                  onCancel: () => setAdding(false),
                })}
                placeholder="参数名称，如：水彩风格"
                aria-label="自定义参数名称"
                className="h-6 w-40 text-[11px]"
              />
              {CUSTOM_INPUT_KINDS.map((item) => (
                <Button
                  key={item.kind}
                  variant="outline"
                  size="xs"
                  title={item.hint}
                  onClick={() => setDraftKind(item.kind)}
                  className={`h-auto rounded px-2 py-0.5 text-[10px] ${
                    draftKind === item.kind
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {item.label}
                </Button>
              ))}
              <Button
                variant="primary-solid"
                size="xs"
                onClick={submitCustom}
                disabled={draftName.trim() === ""}
                className="h-auto rounded px-2 py-0.5 text-[10px]"
              >
                添加
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setAdding(false)}
                className="text-muted-foreground h-auto rounded px-2 py-0.5 text-[10px]"
              >
                取消
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setAdding(true)}
              className="border-primary/40 text-primary hover:bg-primary/10 h-auto rounded border-dashed px-2 py-0.5"
            >
              ＋ 新增自定义参数
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

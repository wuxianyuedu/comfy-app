"use client";

// ── 参考图装载预设库（#4376，规范 §17.2 第③层视图 + ②层 hook）────────────
// 左列预设清单（新建 / 删除 / 选中），右侧编辑器：名称 + 装载链可视化
// （LoadImage → 各级处理节点卡片，控件值就地编辑）+ 从 ComfyUI 节点目录搜节点
// 追加。保存 = 整份清单全量覆盖（`referenceLoader.presetsSave`）。
//
// 链的语义（执行期见 `~/lib/comfyui/reference-loader-chain`）：LoadImage 的
// 图像输出口 → 各级处理的第一个连线入口串到最后一级；链尾的全部输出口就是
// 装载出口（目标端口是 MASK 口时自动挑 MASK 出口）。分支式子图暂不支持 ——
// 参考图装载链是线性的，线性表达覆盖issue里的完整流程。

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Trash2, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { SelectMenu } from "~/components/ui/select-menu";
import type { ReferenceChainClassDef } from "~/lib/comfyui/reference-loader-catalog";
import { selectedComboOption } from "~/lib/comfyui/reference-loader-catalog";
import type {
  ReferenceLoaderPreset,
  ReferenceLoaderStep,
} from "~/lib/workshop/reference-loader-preset";
import { upperToken } from "~/lib/upper-token";
import { nextId } from "~/lib/unique-id";

import {
  useNodeClassCatalog,
  useReferenceLoaderPresets,
} from "../hooks/use-reference-loader-presets";
import { useToast } from "../../ToastProvider";

/** 空目录常量：查询未就绪时的稳定回落（避免每次渲染新对象）。 */
const EMPTY_CATALOG: Record<string, ReferenceChainClassDef> = {};

type Props = {
  onClose: () => void;
  open: boolean;
};

function newPresetId(): string {
  return nextId("rp-");
}

/** 部件值 → 文本（控件显示用）：只有原始类型直转，其余给空串兜底。 */
function unknownToText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** 部件值控件：COMBO 出下拉，数值出数字框，其余出文本框。顶层部件与动态 COMBO
 *  的子输入（#4404）共用这一份 —— 传各自的类型与候选即可。 */
function WidgetField(props: {
  choices: Array<string>;
  name: string;
  onChange: (value: unknown) => void;
  type: string;
  value: unknown;
}) {
  const { choices, name, onChange, type, value } = props;
  const normalizedType = upperToken(type);
  if (choices.length > 0) {
    return (
      <SelectMenu
        aria-label={name}
        autoFitFromOptions={false}
        className="text-3xs h-7 w-full"
        labels={Object.fromEntries(choices.map((choice) => [choice, choice]))}
        onChange={(next) => {
          onChange(next);
        }}
        options={choices.map((choice) => String(choice))}
        popoverMinWidth={140}
        value={value === null || value === undefined ? (choices[0] ?? "") : unknownToText(value)}
      />
    );
  }
  if (normalizedType === "INT" || normalizedType === "FLOAT") {
    return (
      <Input
        aria-label={name}
        className="text-3xs h-7 w-full font-mono"
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const num = Number(raw);
          onChange(Number.isNaN(num) ? raw : num);
        }}
        type="number"
        value={value === null || value === undefined ? "" : unknownToText(value)}
      />
    );
  }
  return (
    <Input
      aria-label={name}
      className="text-3xs h-7 w-full"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      type="text"
      value={value === null || value === undefined ? "" : unknownToText(value)}
    />
  );
}

/** 换动态 COMBO 的选中项：写新选择器值，并清掉上一项遗留的点号子输入值 ——
 *  不同选项的子输入集不同，旧值留着既不生效还会在保存里越积越多。 */
function widgetsAfterSelectorChange(
  widgets: Record<string, unknown> | undefined,
  name: string,
  next: unknown,
): Record<string, unknown> {
  const prefix = `${name}.`;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(widgets ?? {})) {
    if (!key.startsWith(prefix)) {
      out[key] = val;
    }
  }
  out[name] = next;
  return out;
}

export function ReferenceLoaderPresetModal({ onClose, open }: Props) {
  const { presets, save } = useReferenceLoaderPresets();
  const toast = useToast();

  /* 打开时拷一份草稿：编辑都在草稿上做，点「保存」才整份覆盖落盘。 */
  const [draft, setDraft] = useState<Array<ReferenceLoaderPreset>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    /* effect 体里同步 setState 会被 set-state-in-effect 拦（规范 08 §8.6 写法二）：
     * 后置到 render 提交后执行。 */
    const timer = setTimeout(() => {
      setDraft(presets.map((preset) => ({ ...preset, steps: [...preset.steps] })));
      setSelectedId(presets[0]?.id ?? null);
      setSearch("");
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [open, presets]);

  const selected = draft.find((preset) => preset.id === selectedId) ?? null;

  /* 选中预设（含草稿里新加的）的节点类定义：控件字段按它渲染。 */
  const stepClasses = useMemo(
    () => (selected ? [...new Set(selected.steps.map((step) => step.class))] : []),
    [selected],
  );
  const defsQ = useNodeClassCatalog({
    classes: stepClasses,
    enabled: open && stepClasses.length > 0,
  });
  const defs: Record<string, ReferenceChainClassDef> = defsQ.data?.catalog ?? EMPTY_CATALOG;
  /* 加节点的搜索结果。 */
  const searchQ = useNodeClassCatalog({
    search: search.trim(),
    enabled: open && search.trim().length >= 2,
  });
  const searchResults = useMemo(() => {
    const catalog = searchQ.data?.catalog ?? {};
    return Object.keys(catalog).sort();
  }, [searchQ.data]);

  const patchPreset = (patch: Partial<ReferenceLoaderPreset>) => {
    if (!selected) {
      return;
    }
    setDraft((prev) =>
      prev.map((preset) => (preset.id === selected.id ? { ...preset, ...patch } : preset)),
    );
  };

  const patchStep = (index: number, patch: Partial<ReferenceLoaderStep>) => {
    if (!selected) {
      return;
    }
    setDraft((prev) =>
      prev.map((preset) =>
        preset.id === selected.id
          ? {
              ...preset,
              steps: preset.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
            }
          : preset,
      ),
    );
  };

  const addStep = (className: string) => {
    if (!selected) {
      return;
    }
    const def = searchQ.data?.catalog?.[className];
    const widgets: Record<string, unknown> = {};
    if (def) {
      for (const name of def.widgetOrder) {
        widgets[name] = def.defaults[name] ?? null;
      }
    }
    patchPreset({ steps: [...selected.steps, { class: className, widgets }] });
  };

  const removeStep = (index: number) => {
    if (!selected) {
      return;
    }
    patchPreset({ steps: selected.steps.filter((_, i) => i !== index) });
  };

  const createPreset = () => {
    const preset: ReferenceLoaderPreset = {
      id: newPresetId(),
      name: `装载预设 ${draft.length + 1}`,
      steps: [],
    };
    setDraft((prev) => [...prev, preset]);
    setSelectedId(preset.id);
  };

  const removePreset = (id: string) => {
    setDraft((prev) => prev.filter((preset) => preset.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const normalized = await save(draft);
      setDraft(normalized.map((preset) => ({ ...preset, steps: [...preset.steps] })));
      toast.success("装载预设已保存");
    } catch (error) {
      toast.error("装载预设保存失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="max-w-4xl"
        popupClassName={`flex ${OVERLAY_MAX_HEIGHT} flex-col`}
        showCloseButton={false}
      >
        <div className="border-border-subtle flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-ink text-sm font-semibold">参考图装载预设</h2>
            <p className="text-muted-foreground text-3xs">
              描述「一张参考图如何装载进工作流」：LoadImage 之后串哪些处理节点。
              生成时每张参考图按选中预设动态生成这条子图，并连到它该到的所有端口。
            </p>
          </div>
          <Button aria-label="关闭" onClick={onClose} size="icon" variant="ghost">
            <X className="size-4" data-icon="inline-start" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[190px_1fr] overflow-hidden">
          {/* 左列：预设清单 */}
          <div className="border-border-subtle flex min-h-0 flex-col gap-2 overflow-y-auto border-r p-3">
            <Button className="w-full" onClick={createPreset} size="sm" variant="outline">
              <Plus className="size-3.5" data-icon="inline-start" /> 新建预设
            </Button>
            {draft.map((preset) => (
              <div
                className={`border-border flex items-center gap-1 rounded-lg border px-2 py-1.5 ${
                  preset.id === selectedId ? "border-primary bg-primary/5" : "bg-surface"
                }`}
                key={preset.id}
              >
                <Button
                  className="text-ink min-w-0 flex-1 justify-start px-1 text-left text-xs"
                  onClick={() => {
                    setSelectedId(preset.id);
                  }}
                  variant="ghost"
                >
                  <span className="block truncate">
                    {preset.name}
                    <span className="text-muted-foreground/60 text-3xs block">
                      {preset.steps.length === 0
                        ? "直连（无处理）"
                        : `${preset.steps.length} 级处理`}
                    </span>
                  </span>
                </Button>
                <Button
                  aria-label={`删除预设 ${preset.name}`}
                  className="text-muted-foreground hover:text-destructive size-6 shrink-0"
                  onClick={() => {
                    removePreset(preset.id);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" data-icon="inline-start" />
                </Button>
              </div>
            ))}
            {draft.length === 0 && (
              <p className="text-muted-foreground/70 text-3xs">
                还没有预设。不配预设的参考图按「裸 LoadImage 直连」装载。
              </p>
            )}
          </div>

          {/* 右列：选中预设的编辑器 */}
          <div className="min-h-0 overflow-y-auto p-4">
            {selected === null ? (
              <p className="text-muted-foreground text-xs">在左侧选择一个预设进行编辑。</p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">预设名称</span>
                  <Input
                    aria-label="预设名称"
                    className="h-8 flex-1 text-xs"
                    onChange={(event) => {
                      patchPreset({ name: event.target.value });
                    }}
                    type="text"
                    value={selected.name}
                  />
                </div>

                {/* 装载链可视化：LoadImage → 各级处理卡片 */}
                <div className="border-border/60 bg-surface rounded-xl border p-3">
                  <p className="text-muted-foreground text-3xs mb-2">
                    装载链（执行时每张参考图实例化一条；控件值缺省回落节点类默认值）
                  </p>
                  <div className="flex flex-wrap items-stretch gap-2">
                    <div className="border-primary/40 bg-primary/5 w-44 rounded-lg border p-2">
                      <p className="text-ink text-3xs font-semibold">加载图像 (LoadImage)</p>
                      <p className="text-muted-foreground/70 text-3xs mt-1">
                        参考图文件名在生成时写入，不用在这里配。
                      </p>
                    </div>
                    {selected.steps.map((step, index) => {
                      const def = defs[step.class];
                      return (
                        <div className="flex items-stretch gap-2" key={`${index}-${step.class}`}>
                          <ChevronRight className="text-muted-foreground/50 my-auto size-4 shrink-0" />
                          <div className="border-border bg-panel w-52 rounded-lg border p-2">
                            <div className="mb-1 flex items-center justify-between gap-1">
                              <p className="text-ink text-3xs truncate font-semibold">
                                {def ? step.class : `${step.class}（类定义缺失）`}
                              </p>
                              <Button
                                aria-label={`移除第 ${index + 1} 级 ${step.class}`}
                                className="text-muted-foreground hover:text-destructive size-6 shrink-0"
                                onClick={() => {
                                  removeStep(index);
                                }}
                                size="icon"
                                variant="ghost"
                              >
                                <Trash2 className="size-3" data-icon="inline-start" />
                              </Button>
                            </div>
                            {def ? (
                              def.inputs
                                .filter((port) => !port.wire)
                                .map((port) => {
                                  const rawValue =
                                    step.widgets?.[port.name] ?? def.defaults[port.name] ?? null;
                                  const choices =
                                    def.choices[port.name] ??
                                    (upperToken(port.type) === "COMBO" &&
                                    typeof rawValue === "string"
                                      ? [rawValue]
                                      : []);
                                  /* 动态 COMBO：按选中项展开子输入（值存点号全名）。 */
                                  const option = selectedComboOption(def, port.name, rawValue);
                                  const wireSubs = option?.subs.filter((sub) => sub.wire) ?? [];
                                  return (
                                    <div className="mb-1" key={port.name}>
                                      <p className="text-muted-foreground/70 text-3xs truncate">
                                        {port.name}
                                      </p>
                                      <WidgetField
                                        choices={choices}
                                        name={port.name}
                                        onChange={(value) => {
                                          const patch = option
                                            ? widgetsAfterSelectorChange(
                                                step.widgets,
                                                port.name,
                                                value,
                                              )
                                            : { ...step.widgets, [port.name]: value };
                                          patchStep(index, { widgets: patch });
                                        }}
                                        type={port.type}
                                        value={rawValue}
                                      />
                                      {option && option.subs.some((sub) => !sub.wire) && (
                                        <div className="border-border/50 mt-1 ml-2 border-l pl-2">
                                          {option.subs
                                            .filter((sub) => !sub.wire)
                                            .map((sub) => (
                                              <div className="mb-1" key={sub.name}>
                                                <p className="text-muted-foreground/70 text-3xs truncate">
                                                  {sub.name}
                                                </p>
                                                <WidgetField
                                                  choices={sub.choices}
                                                  name={`${port.name}.${sub.name}`}
                                                  onChange={(value) => {
                                                    patchStep(index, {
                                                      widgets: {
                                                        ...step.widgets,
                                                        [`${port.name}.${sub.name}`]: value,
                                                      },
                                                    });
                                                  }}
                                                  type={sub.type}
                                                  value={
                                                    step.widgets?.[`${port.name}.${sub.name}`] ??
                                                    sub.default ??
                                                    null
                                                  }
                                                />
                                              </div>
                                            ))}
                                        </div>
                                      )}
                                      {wireSubs.length > 0 && (
                                        <p className="text-muted-foreground/60 text-3xs mt-1">
                                          {wireSubs.map((sub) => sub.name).join("、")}{" "}
                                          要连线输入，装载链接不了 —— 生成时该端点回落裸装载。
                                        </p>
                                      )}
                                    </div>
                                  );
                                })
                            ) : (
                              <p className="text-destructive text-3xs">
                                节点类定义不可用（ComfyUI 未在线或类名不存在）
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 加节点：按关键词搜 ComfyUI 节点目录 */}
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      aria-label="搜索节点类"
                      className="text-3xs h-7 flex-1"
                      onChange={(event) => {
                        setSearch(event.target.value);
                      }}
                      placeholder="搜索节点类（如 Resize、ImageScale），至少 2 个字符"
                      type="text"
                      value={search}
                    />
                  </div>
                  {search.trim().length >= 2 && searchResults.length > 0 && (
                    <div className="border-border mt-2 flex flex-wrap gap-1 rounded-lg border p-2">
                      {searchResults.map((className) => (
                        <Button
                          className="text-ink text-3xs px-2 py-1"
                          key={className}
                          onClick={() => {
                            addStep(className);
                            setSearch("");
                          }}
                          size="sm"
                          variant="outline"
                        >
                          + {className}
                        </Button>
                      ))}
                    </div>
                  )}
                  {search.trim().length >= 2 && searchResults.length === 0 && (
                    <p className="text-muted-foreground/70 text-3xs mt-2">
                      没有匹配的节点类（需要 ComfyUI 在线提供节点目录）。
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    disabled={saving}
                    onClick={() => {
                      void saveAll();
                    }}
                    size="sm"
                  >
                    {saving ? "保存中…" : "保存全部预设"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

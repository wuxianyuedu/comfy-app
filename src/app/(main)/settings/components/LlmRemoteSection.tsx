"use client";

/**
 * 远程模型分区（规范 17 §17.2 第③层，#3501）：左侧供应商清单、右侧供应商详情
 * （内联连接参数 + 模型列表）。
 *
 * 数据来自 `use-settings-providers`（供应商 / 模型读写与探测）、弹窗态来自
 * `use-provider-model-dialogs`、「实际使用」测试弹窗来自 `use-usage-test-dialogs`；
 * 本组件只渲染，不拼请求、不判字段。
 */

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { SettingsCard } from "~/components/ui/settings-card";

import { ProviderDetail } from "./ProviderDetail";
import { ProviderDialog } from "./ProviderDialog";
import { ProviderModelDialog } from "./ProviderModelDialog";
import { UsageTestDialog } from "./UsageTestDialog";
import { useProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import { useSettingsProviders } from "../hooks/use-settings-providers";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import { useUsageTestDialogs } from "../hooks/use-usage-test-dialogs";

export function LlmRemoteSection({ c }: { c: ReadySettingsPageController }) {
  const p = useSettingsProviders();
  const d = useProviderModelDialogs(p);
  const usage = useUsageTestDialogs(c);

  return (
    <>
      {/* 卡片标题去掉（ISSUE #3527）：正文那一列已经有一行分区标题「远程模型」，
          卡片再起一个同名标题就是重复；master 侧更新过的说明文案保留。 */}
      <SettingsCard description="每个供应商维护自己的 Base URL / API Key；接口格式在模型上（同一供应商下不同用途的模型可以各用一套协议）">
        {p.errorText !== null && p.errorText !== "" && (
          <p className="bg-destructive/10 text-danger-strong mb-3 rounded-lg px-3 py-2 text-xs">
            读取供应商失败：{p.errorText}
          </p>
        )}

        {p.loading ? (
          <p className="text-muted-foreground text-2xs">正在读取供应商…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <aside aria-label="供应商列表" className="flex min-w-0 flex-col gap-1.5">
              {p.providers.map((provider) => {
                const active = p.selected?.id === provider.id;
                const owned = p.models.filter((model) => model.providerId === provider.id);
                const enabledCount = owned.filter((model) => model.enabled).length;
                return (
                  <Button
                    aria-current={active ? "true" : undefined}
                    className={`h-auto w-full justify-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-primary-500/40 bg-primary-500/10"
                        : /* 深色下 `border-border` 与行底几乎同色，清单会糊成一块 ——
                             控件可见边界走 ink 档（与 #3527 勾选框同一口径，ISSUE #3495）。 */
                          "border-border bg-surface-row hover:bg-surface-2 dark:border-ink/40"
                    }`}
                    key={provider.id}
                    onClick={() => {
                      p.selectProvider(provider.id);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    {/* 只显示必要内容（#3618）：窄列里塞 Base URL 必然截断成「已…」，
                        第二行改念启停读数 —— 右上角那个总数（不分启停）一并撤掉。 */}
                    <span className="min-w-0 flex-1">
                      <span className="text-ink block truncate text-sm">{provider.name}</span>
                      <span className="text-muted-foreground text-2xs block truncate">
                        {owned.length === 0 ? "暂无模型" : `已启用 ${enabledCount}/${owned.length}`}
                        {provider.hasApiKey ? " · 已配密钥" : ""}
                      </span>
                    </span>
                  </Button>
                );
              })}

              <Button
                className="text-muted-foreground hover:text-ink text-2xs mt-1 h-auto rounded-md px-2 py-1.5"
                onClick={() => {
                  d.openAddProvider();
                }}
                variant="outline"
              >
                ＋ 新建供应商
              </Button>
            </aside>

            <section aria-label="供应商详情" className="min-w-0">
              {p.selected ? (
                <ProviderDetail
                  d={d}
                  key={p.selected.id}
                  p={p}
                  provider={p.selected}
                  usage={usage}
                />
              ) : (
                <EmptyState
                  className="border-border dark:border-ink/40"
                  description="先「新建供应商」填好 Base URL / 格式 / 密钥，再往里添加模型。"
                  minHeightClass="min-h-36"
                  title="还没有供应商"
                />
              )}
            </section>
          </div>
        )}

        <p className="text-muted-foreground text-2xs mt-4 mb-2 leading-relaxed">
          <strong className="text-ink/80">保存位置</strong>
          ：供应商落在本地 SQLite 的 <code className="text-ink/80">
            llmProvider
          </code> 表、模型落在{" "}
          <code className="text-ink/80">remoteModel</code> 表（默认{" "}
          <code className="text-ink/80">db.sqlite</code>，路径由{" "}
          <code className="text-ink/80">DATABASE_URL</code> 指定）。API Key 以 AES-256-GCM
          加密存放，不会以明文下发到浏览器。
        </p>

        <p className="text-muted-foreground text-2xs leading-relaxed">
          「测试连接」按当前填写的 Base URL / 格式 /
          密钥探测接口（不生成、不耗额度）；「测试生成」按实际用法发起一次真实调用（参数可在弹窗内自定义，图片
          /
          视频会消耗额度）。停用的模型不会出现在工坊的模型下拉里；实际使用哪个模型在工坊运行界面选择。
        </p>
      </SettingsCard>

      {d.providerDialog && <ProviderDialog d={d} p={p} />}

      {d.modelDialog && <ProviderModelDialog d={d} dialog={d.modelDialog} p={p} />}

      {usage.usageTest && <UsageTestDialog c={c} d={usage} usageTest={usage.usageTest} />}
    </>
  );
}

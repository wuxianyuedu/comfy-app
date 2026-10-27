## Fixed

- **阶段⑥不再「导个清单就当做完」**：工坊成片合成阶段（`FinalComposer`）原先点「导出合成清单」
  会把该阶段标成完成，提示写「✓ 合成清单已导出，成片产物完成」，但清单只是 JSON 规划、
  **不产 MP4**，用户会以为成片做完了（ISSUE #2476）。

  - `FinalComposer` 新增 `onComposeFilm?: () => void` 出口；文案改为明确区分「**还不是成片
    MP4**」，并常驻一个「去成片合成 MP4」按钮（仅在注入出口时显示）。
  - `useWorkshopPipeline` 新增 `goToFilm`：复用既有的 `workspace:navigate` 广播
    （`emitAppEvent("workspace:navigate", { view: "film" })`，与 `openModelAdapters` 同一条
    通道），不新增 props 透传；`WorkshopStageBody` 把 `goToFilm` 注入 `FinalComposer`。
  - 落到「成片」视图后，该视图已能从活跃项目读镜头并一键成片
    （`vanillaApi.film.createFromProject`，见 `use-film-studio.ts`），即满足「一键创建并带入
    production.shots」—— 出口缺口闭环。
  - `FinalComposer.test.tsx` 补两条验收：传入 `onComposeFilm` 时按钮出现且点击调用；未传入时不渲染。
  - 同步产品文档 `docs/product/pipeline-stages.md` ⑥「已知缺口」：出口缺失这条已闭环。

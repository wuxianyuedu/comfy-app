import type { Meta, StoryObj } from "@storybook/nextjs";

import { LogPanelFooter } from "~/components/studio/logs/LogPanelFooter";
import { useLogPanel } from "~/components/studio/logs/LogProvider";
import { LOG_PAGE_SIZE, LOG_STORE_MAX } from "~/components/studio/logs/log-store";
import { tailPages } from "~/lib/page-window";
import { logSceneArgType } from "../../../../.storybook/store-sources";

/**
 * 日志面板的**页脚**：那一行「现在看的是哪一段、还有多少」+ 翻页 + 「回到最新」。
 *
 * 它是**纯 props**（`safePage` / `totalPages` / `droppedTotal` …），所以这一组
 * 里没有注入层的事。要摆的是它自己那三处**只有真数字才看得出对错**的东西：
 *
 *  · **翻页边界**（`safePage === 1` 时「更新的一页」禁用、`=== totalPages` 时
 *    「更早的一页」禁用）—— 手抄页码会在页大小改了之后继续「看着正常」；
 *  · **「更早 N 条已折叠」**：`LOG_STORE_MAX`（5000）之外的条目会被折叠，那一句
 *    只在 `droppedTotal > 0` 时出现 —— 它是「面板不是全部历史」的唯一提示；
 *  · **服务进程徽标**（`bootId`）截尾成 `:XX:YY` 的形态。
 *
 * 数字全部从**真 store 切片**读（`useLogPanel`，与 `LogPanel` 里那几行同一个
 * selector），不手抄一个 `total: 12` —— 那种数字在场景换了之后仍然显示旧值。
 */
const meta = {
  component: LogPanelFooter,
  parameters: { storeScene: "mixed" },
  title: "Studio/Logs/LogPanelFooter",
} satisfies Meta<typeof LogPanelFooter>;

export default meta;

/* story 的类型取自**适配件**：数字全从真 store 切片读，不在文件里填。 */
type Story = StoryObj<typeof FooterHarness>;

/**
 * 适配件：照 `LogPanel` 的写法从 store 取那一组数字。
 *
 * `total` / `totalAll` / `droppedTotal` 都是 store 按真时间线派生的 —— 面板里
 * 那一份从 `panel` 切片读，这里读同一个切片（没有「story 版口径」）。
 */
function FooterHarness({ withPage = false }: { withPage?: boolean }) {
  /* 与 `LogPanel` 里那几行**同一个 selector**（面板读 `header` 切片，
     `bootId` / `droppedTotal` 是它旁边两个独立 selector）——
     没有「story 版口径」。 */
  const { autoScroll, bootId, counts, filter, filteredLogs, origin, pageSize, search } =
    useLogPanel((state) => state.header);
  const droppedTotal = useLogPanel((state) => state.droppedTotal);
  const setOrigin = useLogPanel((state) => state.setOrigin);
  const setFilter = useLogPanel((state) => state.setFilter);
  const setSearch = useLogPanel((state) => state.setSearch);
  const setPage = useLogPanel((state) => state.setPage);

  /* `safePage` / `totalPages` 走**共享出口** `tailPages()`（§12.18 / P63）——
     面板里那份也是它（`selectPageLogs` 包了一层）。这里**不自己算**
     `Math.ceil(len / pageSize)`：页数与钳边界的算式收在 `~/lib/page-window`，
     在 story 里重写一遍正是 P63 那条硬闸要拦的形态（本批实测被拦下过）。

     取 `tailPages(...).totalPages` 而不是另算一个：那个出口的钳边界与「末页」
     语义就是面板显示的来源。`withPage` 让「更早的一页」可点，看第二页的形态。 */
  const { totalPages } = tailPages(filteredLogs, 1, LOG_PAGE_SIZE);
  const safePage = withPage ? Math.min(2, totalPages) : 1;

  return (
    <div className="bg-canvas-deep border-border-strong w-240 max-w-full overflow-hidden rounded-md border">
      <LogPanelFooter
        bootId={bootId}
        droppedTotal={droppedTotal}
        filter={filter}
        jumpToLatest={() => undefined}
        newLogCount={0}
        origin={origin}
        pageSize={pageSize}
        safePage={safePage}
        search={search}
        setFilter={setFilter}
        setOrigin={setOrigin}
        setPage={setPage}
        setSearch={setSearch}
        shouldPin={autoScroll}
        total={filteredLogs.length}
        totalAll={counts.all}
        totalPages={totalPages}
      />
    </div>
  );
}

/** 默认（`mixed`）：第 1 页，三段来源混在一起时的摘要与边界。 */
export const Default: Story = {
  render: () => <FooterHarness />,
};

/**
 * 2600 条：`LOG_PAGE_SIZE`（2000）之外还有货 —— `totalPages` 变 2、
 * 「更早的一页」可点。这个数字由页大小常量算出来，不在这里写死。
 */
export const LongTimeline: Story = {
  parameters: { storeScene: "longTimeline" },
  render: () => <FooterHarness />,
};

/** 翻到第 2 页：「更新的一页」可点、「更早的一页」到边的形态。 */
export const SecondPage: Story = {
  parameters: { storeScene: "longTimeline" },
  render: () => <FooterHarness withPage />,
};

/** 空时间线：摘要说「无匹配日志」（不是「0 条」那种既像有又像没有的说法）。 */
export const Empty: Story = {
  parameters: { storeScene: "empty" },
  render: () => <FooterHarness />,
};

/* 页大小与内存上限都取自 store 常量（上面派生用），不手抄数字。
   `LOG_STORE_MAX` 这一行是刻意留下的可见入口：`droppedTotal` 只在那之上才非零。 */
void LOG_STORE_MAX;
void logSceneArgType;

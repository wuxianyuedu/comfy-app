import { PageLoading } from "~/components/ui/page-loading";
import { FULL_PAGE_CLEARANCE_CLASS } from "~/lib/full-screen-layer";

/* 挂载点级的整屏加载态：与错误页 / 404 / 登录页同一形态，得让出窗口标题行，
   否则壳里右上角的关闭按钮会被这块加载层盖住（ISSUE #1794 的同一处约束）。 */
export default function Loading() {
  return <PageLoading className={`bg-canvas ${FULL_PAGE_CLEARANCE_CLASS}`} />;
}

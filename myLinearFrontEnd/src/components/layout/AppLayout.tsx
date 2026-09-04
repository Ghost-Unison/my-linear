import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"

// 全局布局：左侧栏（workspace 切换 + 导航）+ 右侧内容区，见 P0.md §0 全局布局
export function AppLayout() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      {/* scrollbar-gutter: stable 预留滚动条位置，防止内容超高时布局横向抖动 */}
      <main className="min-w-0 flex-1 overflow-auto scrollbar-gutter-stable">
        <Outlet />
      </main>
    </div>
  )
}

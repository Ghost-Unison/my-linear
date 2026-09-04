import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"
import { router } from "./App"
import "./i18n" // 初始化 i18next（同步资源，渲染前就绪，无闪烁）
import "./index.css"

// retry: 1 —— 本地工具不需要默认 3 次指数退避，后端不可达时尽快露出错误
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

import { createBrowserRouter } from "react-router-dom"
import { AppLayout } from "@/components/layout/AppLayout"
import { RootPage } from "@/pages/RootPage"
import { WorkspaceHomePage } from "@/pages/workspace/WorkspaceHomePage"
import { WorkspaceCreatePage } from "@/pages/workspace/WorkspaceCreatePage"
import { ProjectListPage } from "@/pages/projects/ProjectListPage"
import { ProjectDetailPage } from "@/pages/projects/ProjectDetailPage"
import { TaskListPage } from "@/pages/tasks/TaskListPage"
import { TaskDetailPage } from "@/pages/tasks/TaskDetailPage"

// 路由结构对应 docs/product-design/P0.md §4
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <RootPage /> },
      { path: "w/new", element: <WorkspaceCreatePage /> },
      { path: "w/:workspaceId/home", element: <WorkspaceHomePage /> },
      { path: "w/:workspaceId/projects", element: <ProjectListPage /> },
      { path: "w/:workspaceId/projects/:projectId", element: <ProjectDetailPage /> },
      { path: "w/:workspaceId/tasks", element: <TaskListPage /> },
      { path: "w/:workspaceId/tasks/:taskId", element: <TaskDetailPage /> },
    ],
  },
])

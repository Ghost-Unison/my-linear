import type { ReactNode } from "react"
import type { ProjectDetail, UpdateProjectInput } from "@/api/types"
import {
  ProjectDatesEditor,
  ProjectLeadEditor,
  ProjectMembersEditor,
  ProjectPriorityEditor,
  ProjectStatusEditor,
} from "./ProjectPropertyEditors"

interface ProjectPropertiesPanelProps {
  project: ProjectDetail
  workspaceId: string
  onPatch: (input: UpdateProjectInput) => void
  onDelete: () => void
}

/**
 * 右侧属性面板（对齐 Linear Properties，裁剪 Milestones/Progress/Activity，见 P0.md §2）：
 * 标签 + chip 编辑器逐行排布，底部为删除入口。由页面负责挂载/收起（抽屉交互）。
 */
export function ProjectPropertiesPanel({
  project,
  workspaceId,
  onPatch,
  onDelete,
}: ProjectPropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-medium text-muted-foreground">Properties</h2>

      <div className="flex flex-col gap-3">
        <Row label="Status">
          <ProjectStatusEditor project={project} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label="Priority">
          <ProjectPriorityEditor project={project} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label="Lead">
          <ProjectLeadEditor
            project={project}
            workspaceId={workspaceId}
            onPatch={onPatch}
            className="max-w-full"
          />
        </Row>
        <Row label="Members">
          <ProjectMembersEditor
            project={project}
            workspaceId={workspaceId}
            onPatch={onPatch}
            className="max-w-full"
          />
        </Row>
        {/* 两枚日期 chip 纵排：面板窄列放不下横排 */}
        <Row label="Dates">
          <div className="flex flex-col items-start gap-1.5">
            <ProjectDatesEditor project={project} onPatch={onPatch} />
          </div>
        </Row>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
        >
          Delete project
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

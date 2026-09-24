import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import type { ListEmptyStateValue } from "@/lib/list-empty-state"

export type ListEmptyStateProps = {
  state: ListEmptyStateValue
  entity: "task" | "project"
  disabled?: boolean
  onCreate?: () => void
  onEditFilters?: () => void
  onAdjustFilters?: () => void
  onClearTemporary?: () => void
  onAdjustDisplay?: () => void
  onClearSelection?: () => void
}

export function ListEmptyState({
  state,
  entity,
  disabled = false,
  onCreate,
  onEditFilters,
  onAdjustFilters,
  onClearTemporary,
  onAdjustDisplay,
  onClearSelection,
}: ListEmptyStateProps) {
  const { t } = useTranslation()
  const content: {
    title: string
    description?: string
    actionLabel: string
    onAction?: () => void
  } = {
    base: {
      title: t(`listEmpty.base.${entity}`),
      actionLabel: t(`listEmpty.create.${entity}`),
      onAction: onCreate,
    },
    saved: {
      title: t(`listEmpty.saved.${entity}`),
      actionLabel: t("listEmpty.editFilters"),
      onAction: onEditFilters,
    },
    draft: {
      title: t("listEmpty.draft.title"),
      description: t("listEmpty.draft.description", { filter: t("filter.button") }),
      actionLabel: t("listEmpty.adjustFilters"),
      onAction: onAdjustFilters,
    },
    temporary: {
      title: t(`listEmpty.temporary.${entity}`),
      description: state.hiddenCount !== undefined && state.hiddenCount > 0
        ? t(`listEmpty.hidden.${entity}`, { count: state.hiddenCount })
        : undefined,
      actionLabel: t("listEmpty.clearTemporary"),
      onAction: onClearTemporary,
    },
    display: {
      title: t(`listEmpty.display.${entity}`),
      actionLabel: t("listEmpty.adjustDisplay"),
      onAction: onAdjustDisplay,
    },
    selection: {
      title: t("listEmpty.selection"),
      actionLabel: t("listEmpty.clearSelection"),
      onAction: onClearSelection,
    },
    filtered: {
      title: t("listEmpty.filtered"),
      actionLabel: t("listEmpty.clearTemporary"),
      onAction: onClearTemporary,
    },
  }[state.kind]

  return (
    <Empty className="min-h-64 w-full" data-empty-kind={state.kind}>
      <EmptyHeader role="status" aria-live="polite" aria-atomic="true">
        <EmptyTitle>{content.title}</EmptyTitle>
        {content.description && <EmptyDescription>{content.description}</EmptyDescription>}
      </EmptyHeader>
      {content.onAction && (
        <EmptyContent>
          <Button variant={state.kind === "base" ? "primary" : "secondary"} size="sm" disabled={disabled} onClick={content.onAction}>
            {content.actionLabel}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

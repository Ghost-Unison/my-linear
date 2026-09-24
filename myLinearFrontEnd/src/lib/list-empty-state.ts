export type ListEmptyKind = "base" | "saved" | "draft" | "temporary" | "display" | "selection" | "filtered"

export type ListEmptyStateValue = {
  kind: ListEmptyKind
  hiddenCount?: number
}

export function resolveListEmptyState(input: {
  editor: boolean
  savedView: boolean
  hasTemporaryFilters: boolean
  rawCount: number
  visibleCount: number
  selectedCount?: number
  // 基准排除临时筛选，但必须使用与当前列表相同的 Display，并按实体 ID 去重；不能累加组头数量。
  baseline?: { rawCount: number; visibleCount: number }
}): ListEmptyStateValue | null {
  const { editor, savedView, hasTemporaryFilters, rawCount, visibleCount, selectedCount, baseline } = input

  if ((selectedCount ?? visibleCount) > 0) return null
  if (visibleCount > 0 && selectedCount === 0) return { kind: "selection" }

  // 编辑器仅解释草稿结果，不能使用浏览态临时条件或保存基准推断空态。
  if (editor) return { kind: rawCount > 0 ? "display" : "draft" }

  if (hasTemporaryFilters) {
    // 基准仍在加载或不可用时，不推断隐藏原因及数量。
    if (!baseline) return { kind: "filtered" }
    if (baseline.visibleCount > 0) return { kind: "temporary", hiddenCount: baseline.visibleCount }
    // 基准本来被 Display 隐藏，或并发请求使当前原始集先于空基准更新。
    if (rawCount > 0 || baseline.rawCount > 0) return { kind: "display" }
  } else if (rawCount > 0) {
    return { kind: "display" }
  }

  return { kind: savedView ? "saved" : "base" }
}

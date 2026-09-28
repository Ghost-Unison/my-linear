// 独立 Views 统计的实体无关基建（P2.md §4.5）：桶类型、稳定排序、ID 去重与计数收集骨架。
// 任务 / 项目两个统计模块各自只提供「按维度取值」的逻辑，计数口径、去重与排序在此单源，
// 避免两处重复实现同一套 Map/add/sort，也消除 project-stats 仅为一个类型而依赖 task-stats。

export interface ViewStatBucket {
  value: string
  name: string
  count: number
  color?: string
}

/** 保留首个同 ID 行及输入序；统计不能因多值入组或重复行而重复计数。 */
export function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * 收集统计桶：emit 为每个（已去重的）行贡献若干 (value, name, color?) 取值，
 * 计数累加、颜色仅在真值时写入、以及 count desc → name → value 的稳定排序统一在此。
 */
export function collectStatBuckets<T>(
  rows: T[],
  emit: (row: T, add: (value: string, name: string, color?: string) => void) => void,
): ViewStatBucket[] {
  const buckets = new Map<string, ViewStatBucket>()
  const add = (value: string, name: string, color?: string) => {
    const bucket = buckets.get(value)
    if (bucket) bucket.count++
    else buckets.set(value, { value, name, count: 1, ...(color ? { color } : {}) })
  }
  for (const row of rows) emit(row, add)
  return [...buckets.values()].sort(
    (a, b) => b.count - a.count || compareText(a.name, b.name) || compareText(a.value, b.value),
  )
}

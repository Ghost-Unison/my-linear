import { Popover } from "radix-ui"
import { ArrowDown, ArrowUp, ChevronDown, SlidersHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ViewDirectoryDisplay } from "@/pages/views/ViewsLayout"
import { Button, buttonVariants } from "@/components/ui/button"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResetRow, Row } from "@/components/display/panel-parts"

export const VIEWS_DIRECTORY_COLUMNS = [
  { key: "name", labelKey: "viewsPage.name" },
  { key: "createdAt", labelKey: "viewsPage.created" },
  { key: "updatedAt", labelKey: "viewsPage.updated" },
] as const

export const newViewsDirectoryDisplay = (): ViewDirectoryDisplay => ({
  orderField: "name",
  orderDir: "asc",
  visible: { createdAt: true, updatedAt: true },
})

/** 表头和面板共用排序规则：换列升序，同列反转，排序日期列自动显示。 */
export function orderViewsDirectory(state: ViewDirectoryDisplay, field: ViewDirectoryDisplay["orderField"]): ViewDirectoryDisplay {
  return {
    ...state,
    orderField: field,
    orderDir: state.orderField === field && state.orderDir === "asc" ? "desc" : "asc",
    visible: field === "name" ? state.visible : { ...state.visible, [field]: true },
  }
}

export function ViewsDisplayButton({
  state,
  onChange,
}: {
  state: ViewDirectoryDisplay
  onChange: (next: ViewDirectoryDisplay) => void
}) {
  const { t } = useTranslation()
  const modified = state.orderField !== "name" || state.orderDir !== "asc" ||
    !state.visible.createdAt || !state.visible.updatedAt
  const directionLabel = t(state.orderDir === "asc" ? "display.orderAsc" : "display.orderDesc")
  const currentColumn = VIEWS_DIRECTORY_COLUMNS.find((column) => column.key === state.orderField)!

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <RoundIconButton label={t("display.button")} active={modified}>
          <SlidersHorizontal className="size-4" />
        </RoundIconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          aria-label={t("display.button")}
          className="w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover py-2 text-popover-foreground shadow-lg outline-none"
        >
          <Row label={t("display.ordering")}>
            <Button
              variant="ghost"
              size="icon"
              title={directionLabel}
              aria-label={directionLabel}
              onClick={() => onChange(orderViewsDirectory(state, state.orderField))}
            >
              {state.orderDir === "asc" ? <ArrowUp /> : <ArrowDown />}
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                aria-label={t("display.ordering")}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {t(currentColumn.labelKey)}
                <ChevronDown data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={state.orderField}>
                  {VIEWS_DIRECTORY_COLUMNS.map((column) => (
                    <DropdownMenuRadioItem
                      key={column.key}
                      value={column.key}
                      onSelect={() => onChange(orderViewsDirectory(state, column.key))}
                    >
                      {t(column.labelKey)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
          <div className="px-3 pb-1.5 pt-3 text-xs text-muted-foreground">
            {t("display.displayProperties")}
          </div>
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {VIEWS_DIRECTORY_COLUMNS.map((column) => {
              const visible = column.key === "name" || state.visible[column.key]
              const locked = column.key === "name" || column.key === state.orderField
              return (
                <Button
                  key={column.key}
                  size="sm"
                  variant={visible ? "secondary" : "ghost"}
                  className="rounded-full"
                  aria-pressed={visible}
                  disabled={locked}
                  title={locked ? t("viewsPage.requiredColumn") : t(column.labelKey)}
                  onClick={() => {
                    if (column.key !== "name" && !locked) {
                      onChange({ ...state, visible: { ...state.visible, [column.key]: !visible } })
                    }
                  }}
                >
                  {t(column.labelKey)}
                </Button>
              )
            })}
          </div>
          {modified && <ResetRow onReset={() => onChange(newViewsDirectoryDisplay())} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

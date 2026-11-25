// Paging of the list of runs and folders at the top of the Outputs window (Lucas, 2026-11-21: "we need some sort of paging too, this is too many items at once").
// A list of runs never renders more than one page; rows outside the page create no gallery, preview, probe or media. The page and the page size last as long as the app window (module state).
import { reactive } from 'vue'

export const PAGE_SIZES = [10, 25, 50, 100]
export const runPaging = reactive({ page: 1, size: 10 })   // 10 a page by default (Lucas, 2026-11-25: 'default per page to 10, not 25')

/** The page numbers and the slice for a list of `total` rows: `page` is kept inside 1..pages. */
export function pageOfRuns(rows, page = runPaging.page, size = runPaging.size) {
  const total = rows.length, pages = Math.max(1, Math.ceil(total / size)), cur = Math.min(Math.max(1, page), pages)
  return { cur, pages, total, rows: rows.slice((cur - 1) * size, cur * size) }
}
export const resetRunPage = () => { runPaging.page = 1 }

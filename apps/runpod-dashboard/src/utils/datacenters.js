import { t } from '../i18n'

/**
 * The datacenter menu in groups: datacenters with our cards in stock, then the S3 datacenters with cards
 * in stock (uploads need no pod there), and at the bottom every datacenter with none of our cards
 * right now (RunPod lists 34; most have none in the secure cloud at any given moment). `first` is
 * the flat option at the top ("Any" or "Choose"); `extra` keeps a saved id the list lacks selectable.
 */
export function datacenterOptions(list, first, extra) {
  const opt = (d) => ({ value: d.value, text: d.text })
  const inStock = (d) => d.cards && d.cards.length > 0
  const groups = [
    { label: t('dc.groupOther'), options: list.filter((d) => !d.s3 && inStock(d)).map(opt) },
    { label: t('dc.groupS3'), options: list.filter((d) => d.s3 && inStock(d)).map(opt) },
    { label: t('dc.groupNone'), options: list.filter((d) => !inStock(d)).map((d) => ({ value: d.value, text: d.s3 ? `${d.value} · S3` : d.value })) },
  ].filter((g) => g.options.length)
  const out = [first, ...groups]
  if (extra && !list.some((d) => d.value === extra)) out.push({ value: extra, text: extra })
  return out
}

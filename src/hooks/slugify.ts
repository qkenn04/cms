import type { FieldHook } from 'payload'

// "Ra mắt Sản phẩm Đẹp!" -> "ra-mat-san-pham-dep"
export const toSlug = (input: string): string =>
  input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Slug trống thì sinh từ field nguồn (vd `title`); đã có thì chỉ chuẩn hoá
export const slugFrom =
  (sourceField: string): FieldHook =>
  ({ value, data }) => {
    if (typeof value === 'string' && value.trim()) return toSlug(value)
    const source = data?.[sourceField]
    if (typeof source === 'string' && source.trim()) return toSlug(source)
    return value
  }

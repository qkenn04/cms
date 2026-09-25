import type { FieldHook, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

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

// Slug toàn chữ số trùng URL phân trang của site (/blog/2, /en/blog/2) → không cho phép
export const isNumericSlug = (slug: string): boolean => /^\d+$/.test(slug)

export const NUMERIC_SLUG_ERROR =
  'Slug không được chỉ gồm chữ số (trùng URL phân trang như /blog/2), hãy thêm chữ, vd bai-2. ' +
  'Slug cannot be digits only (it collides with pagination URLs like /blog/2); add letters, e.g. bai-2.'

// Giữ validate mặc định của field text, chặn thêm slug toàn chữ số
export const validateSlug: TextFieldSingleValidation = (value, options) => {
  if (typeof value === 'string' && isNumericSlug(value)) return NUMERIC_SLUG_ERROR
  return text(value, options)
}

// Slug trống thì sinh từ field nguồn (vd `title`); đã có thì chỉ chuẩn hoá.
// Có `numericPrefix`: slug tự sinh mà toàn chữ số (tiêu đề "2026") → thêm tiền tố (bai-2026)
// thay vì báo lỗi; slug editor tự nhập thì giữ nguyên để validateSlug báo lỗi rõ ràng.
export const slugFrom =
  (sourceField: string, numericPrefix?: string): FieldHook =>
  ({ value, data }) => {
    if (typeof value === 'string' && value.trim()) return toSlug(value)
    const source = data?.[sourceField]
    if (typeof source === 'string' && source.trim()) {
      const slug = toSlug(source)
      return numericPrefix && isNumericSlug(slug) ? `${numericPrefix}-${slug}` : slug
    }
    return value
  }

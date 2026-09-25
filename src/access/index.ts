import type { Access, FieldAccess } from 'payload'

type Role = 'admin' | 'editor' | 'service'

const hasRole = (user: unknown, ...roles: Role[]): boolean => {
  const userRoles = (user as { roles?: Role[] } | null)?.roles
  return Boolean(userRoles?.some((r) => roles.includes(r)))
}

export const isAdmin: Access = ({ req: { user } }) => hasRole(user, 'admin')

export const isEditorOrAdmin: Access = ({ req: { user } }) => hasRole(user, 'admin', 'editor')

export const isAdminField: FieldAccess = ({ req: { user } }) => hasRole(user, 'admin')

export const canUseAdminPanel = ({ req: { user } }: { req: { user: unknown } }) =>
  hasRole(user, 'admin', 'editor')

export const anyone: Access = () => true

// Người chưa đăng nhập chỉ thấy bản đã publish; draft chỉ lộ khi có session
export const publishedOrLoggedIn: Access = ({ req: { user } }) => {
  if (user) return true
  return { _status: { equals: 'published' } }
}

export const adminOrSelf: Access = ({ req: { user } }) => {
  if (hasRole(user, 'admin')) return true
  if (!user) return false
  return { id: { equals: (user as { id: number | string }).id } }
}

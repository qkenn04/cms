// Ngôn ngữ cho code block (CodeBlock của @payloadcms/richtext-lexical, slug 'Code').
// Key = giá trị lưu trong JSON (field `language` của block) và thành class `language-<key>` trong contentHtml.
// `language` là select trong block Lexical → lưu trong JSON richText, thêm/bớt ở đây KHÔNG cần migration.
export const CODE_LANGUAGES: Record<string, string> = {
  text: 'Plain text',
  bash: 'Bash',
  sh: 'sh',
  shell: 'Shell',
  console: 'Console (lệnh + output)',
  yaml: 'YAML',
  json: 'JSON',
  ts: 'TypeScript (ts)',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript (js)',
  javascript: 'JavaScript',
  nginx: 'Nginx',
  dockerfile: 'Dockerfile',
  sql: 'SQL',
  diff: 'Diff',
  markdown: 'Markdown',
  toml: 'TOML',
  ini: 'INI',
  html: 'HTML',
  css: 'CSS',
  astro: 'Astro',
  python: 'Python',
}

export const DEFAULT_CODE_LANGUAGE = 'text'

// Tên hay gặp trong fence markdown → key ở trên
const ALIASES: Record<string, string> = {
  md: 'markdown',
  yml: 'yaml',
  py: 'python',
  zsh: 'shell',
  docker: 'dockerfile',
  plaintext: 'text',
  txt: 'text',
}

/** Key hợp lệ của CODE_LANGUAGES cho 1 tên ngôn ngữ bất kỳ; không biết → undefined */
export const normalizeCodeLanguage = (lang: string | null | undefined): string | undefined => {
  const key = (lang ?? '').trim().toLowerCase()
  if (!key) return undefined
  if (key in CODE_LANGUAGES) return key
  const alias = ALIASES[key]
  return alias && alias in CODE_LANGUAGES ? alias : undefined
}

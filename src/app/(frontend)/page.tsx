import { redirect } from 'next/navigation'

// CMS không có trang public — site đọc bài là Astro (qkenn-site)
export default function HomePage() {
  redirect('/admin')
}

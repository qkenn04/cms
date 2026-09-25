// Next.js gọi register() một lần khi server khởi động.
// Khởi tạo Payload với cron để jobs.autoRun (scheduled publish) chạy ngay,
// không phải đợi request đầu tiên sau mỗi lần restart container.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { getPayload } = await import('payload')
  const { default: config } = await import('@payload-config')
  await getPayload({ config, cron: true })
}

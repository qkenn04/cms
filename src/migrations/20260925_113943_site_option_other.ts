import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Đổi tên giá trị thứ hai của select `site` thành 'other'.
// Viết tay thay cho SQL drizzle sinh (text → DROP TYPE → CREATE TYPE → cast lại):
// RENAME VALUE giữ nguyên OID của nhãn nên mọi hàng đang dùng giá trị cũ tự thành 'other', không mất dữ liệu.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_posts_site" RENAME VALUE 'nail' TO 'other';
  ALTER TYPE "public"."enum__posts_v_version_site" RENAME VALUE 'nail' TO 'other';
  ALTER TYPE "public"."enum_pages_site" RENAME VALUE 'nail' TO 'other';
  ALTER TYPE "public"."enum__pages_v_version_site" RENAME VALUE 'nail' TO 'other';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_posts_site" RENAME VALUE 'other' TO 'nail';
  ALTER TYPE "public"."enum__posts_v_version_site" RENAME VALUE 'other' TO 'nail';
  ALTER TYPE "public"."enum_pages_site" RENAME VALUE 'other' TO 'nail';
  ALTER TYPE "public"."enum__pages_v_version_site" RENAME VALUE 'other' TO 'nail';`)
}

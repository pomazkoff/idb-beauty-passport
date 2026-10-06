CREATE TYPE "public"."survey_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
ALTER TABLE "survey_versions" ALTER COLUMN "published_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "survey_versions" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD COLUMN "status" "survey_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Данные до этой миграции: все зарегистрированные версии считались опубликованными; публикуем последнюю, остальные в архив.
UPDATE "survey_versions" SET "status" = 'archived';--> statement-breakpoint
UPDATE "survey_versions" SET "status" = 'published' WHERE "version" = (SELECT "version" FROM "survey_versions" ORDER BY "published_at" DESC NULLS LAST LIMIT 1);--> statement-breakpoint
CREATE UNIQUE INDEX "survey_versions_one_published" ON "survey_versions" USING btree ("status") WHERE "survey_versions"."status" = 'published';
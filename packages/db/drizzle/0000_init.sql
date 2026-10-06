CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'superseded', 'dead');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('intro', 'base', 'result1', 'passport', 'result2');--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"session_id" uuid,
	"name" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_ts" timestamp with time zone,
	"server_ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"session_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"option_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"time_ms" integer,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_session_id_question_key_pk" PRIMARY KEY("session_id","question_key")
);
--> statement-breakpoint
CREATE TABLE "ensi_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"survey_version" text NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"stage" "stage" DEFAULT 'intro' NOT NULL,
	"active_category" text,
	"base_completed" boolean DEFAULT false NOT NULL,
	"completed_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "survey_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ensi_outbox" ADD CONSTRAINT "ensi_outbox_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_survey_version_survey_versions_version_fk" FOREIGN KEY ("survey_version") REFERENCES "public"."survey_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_name_ts_idx" ON "analytics_events" USING btree ("name","server_ts");--> statement-breakpoint
CREATE INDEX "analytics_events_customer_ts_idx" ON "analytics_events" USING btree ("customer_id","server_ts");--> statement-breakpoint
CREATE INDEX "ensi_outbox_status_next_idx" ON "ensi_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ensi_outbox_customer_status_idx" ON "ensi_outbox" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_customer_revision_uq" ON "profiles" USING btree ("customer_id","revision");--> statement-breakpoint
CREATE INDEX "profiles_customer_created_idx" ON "profiles" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_customer_status_idx" ON "sessions" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_active_per_customer" ON "sessions" USING btree ("customer_id") WHERE "sessions"."status" = 'active';
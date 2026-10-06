/**
 * Схема хранения (ТЗ 9.3). Персональные данные — только customer_id из ЛК.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const sessionStatus = pgEnum("session_status", ["active", "archived"]);
export const stage = pgEnum("stage", ["intro", "base", "result1", "passport", "result2"]);
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "superseded",
  "dead",
]);

/** Зарегистрированные версии конфига. Сессия привязана к версии, с которой началась. */
export const surveyVersions = pgTable("survey_versions", {
  version: text("version").primaryKey(),
  config: jsonb("config").notNull(),
  checksum: text("checksum").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: text("customer_id").notNull(),
    surveyVersion: text("survey_version")
      .notNull()
      .references(() => surveyVersions.version),
    status: sessionStatus("status").notNull().default("active"),
    stage: stage("stage").notNull().default("intro"),
    /** Категория Паспорта, которую пользователь проходит сейчас. */
    activeCategory: text("active_category"),
    baseCompleted: boolean("base_completed").notNull().default(false),
    /** Пройденные категории в порядке прохождения. */
    completedCategories: text("completed_categories").array().notNull().default(sql`'{}'::text[]`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_customer_status_idx").on(t.customerId, t.status),
    /** Одна активная сессия на клиента. */
    uniqueIndex("sessions_one_active_per_customer")
      .on(t.customerId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const answers = pgTable(
  "answers",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    optionCodes: text("option_codes").array().notNull().default(sql`'{}'::text[]`),
    skipped: boolean("skipped").notNull().default(false),
    timeMs: integer("time_ms"),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.questionKey] })],
);

/** Снапшот BeautyProfile — то, что уходит в ENSI. Новая ревизия на каждое завершение этапа. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: text("customer_id").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("profiles_customer_revision_uq").on(t.customerId, t.revision),
    index("profiles_customer_created_idx").on(t.customerId, t.createdAt),
  ],
);

export const ensiOutbox = pgTable(
  "ensi_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull(),
    revision: integer("revision").notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("ensi_outbox_status_next_idx").on(t.status, t.nextAttemptAt),
    index("ensi_outbox_customer_status_idx").on(t.customerId, t.status),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    customerId: text("customer_id").notNull(),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    clientTs: timestamp("client_ts", { withTimezone: true }),
    serverTs: timestamp("server_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_events_name_ts_idx").on(t.name, t.serverTs),
    index("analytics_events_customer_ts_idx").on(t.customerId, t.serverTs),
  ],
);

export const sessionsRelations = relations(sessions, ({ many, one }) => ({
  answers: many(answers),
  profiles: many(profiles),
  survey: one(surveyVersions, { fields: [sessions.surveyVersion], references: [surveyVersions.version] }),
}));
export const answersRelations = relations(answers, ({ one }) => ({
  session: one(sessions, { fields: [answers.sessionId], references: [sessions.id] }),
}));
export const profilesRelations = relations(profiles, ({ one, many }) => ({
  session: one(sessions, { fields: [profiles.sessionId], references: [sessions.id] }),
  outbox: many(ensiOutbox),
}));
export const ensiOutboxRelations = relations(ensiOutbox, ({ one }) => ({
  profile: one(profiles, { fields: [ensiOutbox.profileId], references: [profiles.id] }),
}));

export type SessionRow = typeof sessions.$inferSelect;
export type AnswerRow = typeof answers.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type OutboxRow = typeof ensiOutbox.$inferSelect;

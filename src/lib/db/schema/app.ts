import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const profileTypeEnum = pgEnum("profile_type", ["business_card", "lost_pet", "lost_device", "lost_id"]);
export const tagStatusEnum = pgEnum("tag_status", ["unclaimed", "active", "disabled"]);
export const formFactorEnum = pgEnum("form_factor", ["card", "collar", "sticker", "keychain", "wristband"]);
export const scanSourceEnum = pgEnum("scan_source", ["nfc", "qr"]);

/** A physical NFC/QR item we ship. Codes are random; the claim code is stored only as a hash. */
export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    publicCode: text("public_code").notNull().unique(),
    claimCodeHash: text("claim_code_hash").notNull(),
    formFactor: formFactorEnum("form_factor").notNull(),
    allowedTypes: profileTypeEnum("allowed_types").array().notNull(),
    status: tagStatusEnum("status").notNull().default("unclaimed"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    batchId: text("batch_id"),
    keyRef: text("key_ref"),
    lastCounter: integer("last_counter").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tags_owner_idx").on(t.ownerId),
    index("tags_batch_idx").on(t.batchId),
    check("tags_active_has_owner", sql`${t.status} <> 'active' OR ${t.ownerId} IS NOT NULL`),
    check("tags_allowed_types_not_empty", sql`cardinality(${t.allowedTypes}) > 0`),
    check("tags_counter_non_negative", sql`${t.lastCounter} >= 0`),
  ],
);

/** Exactly one profile per tag; `data` is validated by the profile type's Zod schema. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tagId: text("tag_id")
      .notNull()
      .unique()
      .references(() => tags.id, { onDelete: "cascade" }),
    type: profileTypeEnum("type").notNull(),
    data: jsonb("data").notNull().default({}),
    lostMode: boolean("lost_mode").notNull().default(false),
    scanAlerts: boolean("scan_alerts").notNull().default(true),
    visibility: jsonb("visibility").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("profiles_lost_mode_only_lost_types", sql`${t.lostMode} = false OR ${t.type} <> 'business_card'`)],
);

/** One row per tap or scan. Never stores a full IP address. */
export const scanEvents = pgTable(
  "scan_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: scanSourceEnum("source").notNull(),
    deviceInfo: text("device_info"),
    ipPrefix: text("ip_prefix"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scan_events_tag_time_idx").on(t.tagId, t.createdAt)],
);

/** Finder → owner messages sent through the relay. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    finderContact: text("finder_contact"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_tag_time_idx").on(t.tagId, t.createdAt),
    check("messages_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
  ],
);

/** Security-relevant actions (claims, disables, admin changes). No secrets or personal data in metadata. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_target_idx").on(t.targetType, t.targetId), index("audit_log_time_idx").on(t.createdAt)],
);

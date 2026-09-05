import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Better Auth tables (drizzle adapter). JS keys match Better Auth's model field names
 * (camelCase); SQL names are snake_case. Model → table mapping lives in src/lib/auth/config.ts.
 * These hold credentials and sessions only — never RSVP or guest facts (ADR-0001).
 */
export const authUsers = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().default(''),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_users_email_idx').on(t.email)],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** Last moment this session proved possession (OTP / passkey). Step-up freshness reads this. */
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true, mode: 'date' }),
    /** Which bound guest this session is currently acting as (shared inboxes may bind several). */
    activeGuestId: text('active_guest_id'),
  },
  (t) => [uniqueIndex('auth_sessions_token_idx').on(t.token), index('auth_sessions_user_idx').on(t.userId)],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true, mode: 'date' }),
    scope: text('scope'),
    /** Never used: passwords do not exist on this site (ADR-0001). Column required by Better Auth. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_accounts_issuer_account_idx').on(t.issuer, t.accountId), index('auth_accounts_user_idx').on(t.userId)],
);

/** OTP codes (hashed) and passkey challenges. Rows are short-lived. */
export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);

export const authPasskeys = pgTable(
  'auth_passkeys',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    aaguid: text('aaguid'),
  },
  (t) => [index('auth_passkeys_user_idx').on(t.userId), index('auth_passkeys_credential_idx').on(t.credentialID)],
);

export type AuthUserRow = typeof authUsers.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type AuthPasskeyRow = typeof authPasskeys.$inferSelect;

-- Sign-in on the Worker itself (client/worker/auth.ts), replacing Cloudflare
-- Access as the way in. Better Auth owns these four tables and writes them in
-- its own shape, so the columns below are exactly what its migration
-- generator compiles for the options in auth.ts, camelCase and all. A test
-- (client/worker/test/auth.db.test.ts) asks the generator again and fails if
-- it would add or change anything, so an upgrade that changes the shape is a
-- new migration, never a surprise.
--
-- They hold sign-in state only. The learner is still the users row, found by
-- the verified address, and an address the tester list does not name never
-- gets a row here: auth.ts refuses it before Better Auth writes one.

-- Who has signed in, by the address Google verified.
create table if not exists "auth_users" (
    "id"            text not null primary key,
    "name"          text not null,
    "email"         text not null unique,
    "emailVerified" integer not null,
    "image"         text,
    "createdAt"     date not null,
    "updatedAt"     date not null
);

-- A signed-in device. The cookie carries the token, signed.
create table if not exists "auth_sessions" (
    "id"        text not null primary key,
    "expiresAt" date not null,
    "token"     text not null unique,
    "createdAt" date not null,
    "updatedAt" date not null,
    "ipAddress" text,
    "userAgent" text,
    "userId"    text not null references "auth_users" ("id") on delete cascade
);

-- The Google account behind a sign-in.
create table if not exists "auth_accounts" (
    "id"                    text not null primary key,
    "accountId"             text not null,
    "providerId"            text not null,
    "userId"                text not null references "auth_users" ("id") on delete cascade,
    "accessToken"           text,
    "refreshToken"          text,
    "idToken"               text,
    "accessTokenExpiresAt"  date,
    "refreshTokenExpiresAt" date,
    "scope"                 text,
    "password"              text,
    "createdAt"             date not null,
    "updatedAt"             date not null
);

-- The few minutes between leaving for Google and coming back.
create table if not exists "auth_verifications" (
    "id"         text not null primary key,
    "identifier" text not null,
    "value"      text not null,
    "expiresAt"  date not null,
    "createdAt"  date not null,
    "updatedAt"  date not null
);

create index if not exists "auth_sessions_userId_idx" on "auth_sessions" ("userId");
create index if not exists "auth_accounts_userId_idx" on "auth_accounts" ("userId");
create index if not exists "auth_verifications_identifier_idx" on "auth_verifications" ("identifier");

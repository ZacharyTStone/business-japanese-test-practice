-- Sign-in for a native build (client/worker/native.ts).
--
-- The app opens the site in a browser tab, Cloudflare Access signs the person
-- in there, and the token the tab ends up holding waits here for the app to
-- collect it: under the hash of a one-time code, beside the challenge made
-- from a secret only the app holds, for two minutes. Collecting a code deletes
-- its row, right secret or not, and every new code and every collection clears
-- the rows past their time, so a row outlasts its two minutes only until the
-- next sign-in. Only an address on the tester list ever gets a row.
create table if not exists native_sign_ins (
    code_hash  text primary key,
    challenge  text not null,
    token      text not null,
    expires_at text not null
);

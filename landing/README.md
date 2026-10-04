# The landing page

What somebody sees at the root domain before they have an account: what
Horenso is, a sample question, the exam it covers, and a link to sign in. The app
itself is on `app.gethorenso.com`, served by the app's own Worker (`client/`).

It is a separate Worker made of files only (`wrangler.jsonc` has no script, no
database, no bucket, no secrets), so nothing on this page can read or write
anything of the app's. There is no build step: `public/` is what is served.

```
public/index.html   the page, every sentence in Japanese and in English
public/404.html     a miss
public/site.css     the styles; the colours are the app's (client/src/ui/theme.ts)
public/lang.js      shows one language: the visitor's choice, else the browser's
public/_redirects   /app and /privacy → the app: the one file with its address
public/_headers     a Content-Security-Policy that allows nothing from elsewhere
```

The page loads nothing from another origin (no web fonts, analytics or
scripts), so a visitor is seen by nobody but Cloudflare and the privacy policy
needs no new sentence. `tests/landing.test.ts` holds it to that, to both
languages for every sentence, and to every link going somewhere.

## Seeing it

```bash
cd landing && npx wrangler dev        # http://localhost:8787, with _redirects and _headers
```

Any static server shows the page too (`python3 -m http.server -d public`), but
without the redirects and headers.

## Putting it on the domain

The domains are `gethorenso.com` (this page; `app.gethorenso.com` is the
app) and `horensoapp.com`, which only redirects. Both were bought through
Cloudflare Registrar on 2026-10-04, so their DNS is already in the account.
The code half is done: `public/_redirects` and both `wrangler.jsonc` files
name the hosts. The rest is the owner's, in this order; none of it is done by
a workflow.

1. **Merge.** The app's Worker deploys and takes `app.gethorenso.com`. It
   also stays on its `workers.dev` address, and sign-in still works only there
   until step 3. If the app's build fails on the route with a permissions
   error, the build's API token cannot edit the zone: give it Workers Routes on
   `gethorenso.com` and re-run; the version already live keeps serving
   meanwhile.
2. **Connect this Worker** (Workers & Pages → Create → Import a repository):
   this repository, root directory `landing`, no build command, deploy command
   `npx wrangler deploy`, production branch `main`. The name must be
   `horenso-landing`, as in `wrangler.jsonc`. Connecting builds `main` at once,
   which deploys the page onto `gethorenso.com`; after that every merge that
   touches it redeploys it.
3. **Move the sign-in to the new host**, both halves together, since a sign-in
   whose `BETTER_AUTH_URL` and redirect URI disagree fails:
   - Google Cloud → Credentials → the **Web** client: add
     `https://app.gethorenso.com/api/auth/callback/google` to the redirect URIs
     and `https://app.gethorenso.com` to the JavaScript origins (keep the old
     ones until the move is done);
   - the app Worker's secret `BETTER_AUTH_URL` → `https://app.gethorenso.com`.
4. **The phone build**: `EXPO_PUBLIC_API_BASE` → `https://app.gethorenso.com`
   in both EAS environments (`client/README.md` has the command), then a new
   build.
5. **Testers sign in once more**: a session cookie belongs to the host that
   set it.
6. **Redirect the other names**, in the dashboard (Rules → Redirect Rules, a
   301 that keeps the path):
   - `www.gethorenso.com` → `https://gethorenso.com`;
   - `horensoapp.com` and `www.horensoapp.com` → `https://gethorenso.com`.
   A redirect rule needs a proxied DNS record to act on: add an `AAAA` record
   `100::` (proxied) for each name that has none.
7. **Google's consent screen** (Branding): app name Horenso, home page
   `https://gethorenso.com`, privacy policy
   `https://app.gethorenso.com/privacy`, and `gethorenso.com` under authorised
   domains. Leaving Testing later asks Google to verify the domain, which is a
   DNS record on a zone already in the account.
8. Once everybody is on the new host, remove the old redirect URI.

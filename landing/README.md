# The landing page

What somebody sees at the root domain before they have an account: what
Horenso is, how it works, what it will not do, and a link to sign in. The app
itself is on `app.<domain>`, served by the app's own Worker (`client/`).

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

Nothing here is live until these are done, by the owner, in this order. Each
step is a dashboard or secret change; none is made by a workflow.

1. **Buy the domain** (Cloudflare Registrar, so its DNS is in the same account).
2. **One pull request** that names it:
   - `public/_redirects`: replace `app.horenso.example` with `app.<domain>`;
   - `wrangler.jsonc`: uncomment `routes` with `<domain>`;
   - `client/wrangler.jsonc`: add
     `"routes": [{ "pattern": "app.<domain>", "custom_domain": true }]`.
3. **Connect this Worker** in the Cloudflare dashboard (Workers & Pages →
   Create → Import a repository): this repository, root directory `landing`,
   no build command, deploy command `npx wrangler deploy`, production branch
   `main`. The Worker name must be `horenso-landing`, as in `wrangler.jsonc`.
4. **Merge** the pull request: both Workers deploy and take their hostnames.
5. **Move the sign-in to the new host**, together, since a sign-in whose
   `BETTER_AUTH_URL` and redirect URI disagree fails:
   - Google Cloud → Credentials → the **Web** client: add
     `https://app.<domain>/api/auth/callback/google` to the redirect URIs and
     `https://app.<domain>` to the JavaScript origins (keep the old ones until
     the move is done);
   - the app Worker's secret `BETTER_AUTH_URL` → `https://app.<domain>`.
6. **The phone build**: `EXPO_PUBLIC_API_BASE` → `https://app.<domain>` in both
   EAS environments (`client/README.md` has the command), then a new build.
7. **Testers sign in once more**: a session cookie belongs to the host that set
   it.
8. **Google's consent screen** (Branding): app name Horenso, home page
   `https://<domain>`, privacy policy `https://app.<domain>/privacy`, and
   `<domain>` under authorised domains. Leaving Testing later asks Google to
   verify the domain, which owning the root makes a DNS record.
9. Once everybody is on the new host, remove the old redirect URI.

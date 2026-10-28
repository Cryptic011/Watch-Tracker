# Odoo Website hosting

The tracker can run directly on the Odoo Website origin while retaining its
existing Supabase backend. The deployment uses Website's built-in HTTP server
action and the website-specific homepage template. It does not use an iframe,
install an additional Odoo app, or use Odoo's external Models API.

## Build and deploy

1. Use the Website-only Odoo setup and verify its plan before making changes.
2. Run `python3 scripts/build-odoo.py --output /path/to/deployment` from the
   desired Git revision. The script leaves the original app files unchanged.
3. In Odoo developer mode, open Settings > Technical > Server Actions > Import.
   Upload `server-actions.csv`, run **Test**, then **Import**. Its stable external
   ID updates the same action on subsequent deployments.
4. Open `/website/action/watchlog/index.html` to check the app before changing
   the homepage. The action serves a fixed map of public build files; it reads
   no Odoo records, request bodies, Supabase data or secrets. Unknown file paths
   return 404.
5. Back up the current website-specific `website.homepage` view. Replace its
   architecture with `homepage.xml` through the technical Views interface.
   Do not replace the generic Odoo homepage shared by other websites.
6. Verify the public root, sign-in screen, offline cache and retained access to
   `/odoo` and `/web/login`. Sign into the tracker with an existing tracker email
   and PIN to load the existing Supabase library.

The service worker is served with the required JavaScript content type and
`Service-Worker-Allowed: /`. Its root scope supports the clean homepage URL;
navigation handling is restricted to the tracker homepage and its app route.
Odoo administration, Odoo login, and other website pages are never cached or
replaced. The app retains its existing Content Security Policy. The worker has
a separate policy allowing its existing static-file and public-artwork fetches.

Website editing and deployment are separate from the GitHub Pages workflow.
After a future app change, rebuild and import the Odoo package too. Do not
announce an Odoo update based only on a successful Pages deployment.

## Origin change

Supabase accounts, library history and reminders remain on the existing backend.
Browser storage, installed home-screen apps and notification permissions belong
to an origin and do not transfer between GitHub Pages and Odoo. Users need to
sign in on the new origin and enable notifications there. Preserve the previous
installation until the new installation and library have been verified.

## Recovery

`homepage-before.xml` is the original website-specific homepage captured before
the first switch. Restore that view and import a previously generated package
to roll back a deployment. None of these operations changes the Supabase
library. Disable or remove the app's root service worker on affected devices
when intentionally reverting to a non-tracker homepage.

# GitHub Pages deployment

Aether Project is built as a static Vite site and can be hosted on GitHub Pages.

## One-time repository setup

1. Open the repository **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Merge the deployment workflow into `main`.

## Deployment

The workflow `.github/workflows/deploy-pages.yml` builds the site and deploys the `dist/` directory whenever `main` is updated. It can also be started manually from **Actions → Deploy to GitHub Pages → Run workflow**.

The expected project-site address is:

`https://blackzecond.github.io/Aether-project/`

GitHub displays the canonical address under **Settings → Pages** after the first successful deployment.

## Notes

- Pull requests run the normal CI checks but do not publish the site.
- The Vite configuration uses relative asset paths (`base: "./"`), which supports the repository subpath.
- Supabase remains the backend. Only public client-side configuration belongs in the deployed frontend; never expose a Supabase service-role key.

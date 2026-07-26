# GitHub to Cloudflare Pages Auto Deploy

This repository deploys automatically when `main` is pushed.

## GitHub Secrets

Add these repository secrets in GitHub:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Cloudflare Pages edit permission.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.

Optional repository variable:

- `CLOUDFLARE_PROJECT_NAME`: Cloudflare Pages project name. Defaults to `momgagym-cms2`.

## Build Settings

- Install command: `npm ci`
- Test command: `npm test`
- Build command: `npm run build`
- Output directory: `dist`

## Notes

Video files are not uploaded by the report pipeline. Measurement result data is saved separately from report summary data, and the web app build artifact only contains the static app files.

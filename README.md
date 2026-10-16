This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Stock iPhone Duo (`/stock-iphone`)

Live in-store pickup availability for the iPhone Duo, based on Apple's public
`shop/retail/pickup-message` endpoint and proxied by `/api/apple-stock`. The endpoint is
undocumented and can change at any time.

### Background alerts (browser closed)

1. On the page, "Activer les alertes en arrière-plan" registers `public/sw.js`, subscribes
   to Web Push and saves a *watch* (target + channels) through `POST /api/watches`.
2. A scheduler calls `GET /api/cron/stock-check` with `Authorization: Bearer $CRON_SECRET`.
   Each watch is checked, and an alert is sent once per store × configuration that
   becomes available (it re-arms when that pair goes out of stock again).
3. Channels: Web Push (VAPID), ntfy.sh (phone fallback), and optional e-mail through Resend.

Environment variables are listed in `.env.example`. To go live on Vercel:

- **Storage:** add *Upstash for Redis* from the Vercel Marketplace to the project. It sets
  `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
- **Web Push:** run `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
- **Cron secret:** set `CRON_SECRET` to a long random string.
- **Scheduler:**
  - Hobby plan: the `.github/workflows/stock-check.yml` workflow runs every 5 minutes.
    Add the repository secrets `STOCK_CHECK_URL`
    (`https://<domaine>/api/cron/stock-check`) and `CRON_SECRET`.
  - Pro plan: Vercel Cron can be used instead. Add
    `{"crons":[{"path":"/api/cron/stock-check","schedule":"*/5 * * * *"}]}` to `vercel.json`.
- **E-mail (optional):** set `RESEND_API_KEY` and `ALERT_EMAIL_FROM`.

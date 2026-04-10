# Canopy Capital — Lead Outreach Tool

Internal tool for uploading, deduplicating, and sending personalized SMS campaigns to Wayne County leads via Twilio.

## Flow
Upload file → Map columns → Craft message → Review → Send campaign → Done

## Stack
- React 18 + Vite (frontend)
- Vercel serverless function (backend API route)
- Twilio SMS API
- XLSX.js for file parsing
- Playfair Display + DM Sans fonts

---

## Local development

```bash
npm install
npm run dev
```

Runs at `http://localhost:5173`

> Note: The `/api/send-sms` route only works when deployed to Vercel. For local testing of the SMS route, use `vercel dev` (requires Vercel CLI).

---

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Add New Project → select repo
3. Vite is auto-detected — click **Deploy**
4. Go to **Settings → Environment Variables** and add:

| Variable               | Value                        |
|------------------------|------------------------------|
| TWILIO_ACCOUNT_SID     | Your Twilio Account SID      |
| TWILIO_AUTH_TOKEN      | Your Twilio Auth Token       |
| TWILIO_PHONE_NUMBER    | Your Twilio number (+1XXXXXXXXXX) |

5. Redeploy after adding env vars (Settings → Deployments → Redeploy)

---

## Custom domain (IONOS)

1. In Vercel: Settings → Domains → add `tools.canopycapitalgrp.com`
2. In IONOS: Add a CNAME record:
   - Host: `tools`
   - Points to: `cname.vercel-dns.com`
3. Wait 10–30 minutes — SSL is automatic

---

## Twilio setup reminder
- Account SID and Auth Token: [console.twilio.com](https://console.twilio.com)
- Make sure your Twilio number is SMS-enabled
- If your Twilio account is in trial mode, you can only send to verified numbers
- Upgrade to a paid account to send to all contacts

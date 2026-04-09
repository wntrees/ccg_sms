# Canopy Capital — Contact Upload Tool

A personal web app for uploading, deduplicating, and pushing Wayne County lead contacts directly to Google Sheets.

## What it does

- Upload `.xlsx` or `.csv` lead files (drag & drop or browse)
- Auto-maps column headers to standard contact fields
- Deduplicates contacts by phone number
- Review removed duplicates before pushing
- Push clean contacts directly to your Google Sheets Contacts tab
- Choose to append or overwrite on each upload
- Download a clean CSV at any step

---

## Local development

```bash
npm install
npm run dev
```

App runs at `http://localhost:5173`

---

## Deploy to Vercel (via GitHub)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub
3. Click **Add New Project** → select this repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Your app is live at `https://your-project.vercel.app`

Every time you push changes to GitHub, Vercel redeploys automatically.

---

## Google Sheets setup

The app pushes to your Contacts sheet via a Google Apps Script Web App.

**Apps Script code** (Extensions → Apps Script in your Google Sheet):

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.openById("YOUR_SHEET_ID")
    .getSheetByName("Contacts");
  const data = JSON.parse(e.postData.contents);

  if (data.mode === "overwrite") {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  }

  if (data.headers && sheet.getLastRow() === 0) {
    sheet.appendRow(data.headers);
  }

  data.rows.forEach(row => sheet.appendRow(row));

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, added: data.rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput("OK");
}
```

**Deploy settings:**
- Execute as: **Me**
- Who has access: **Anyone**

Update `APPS_SCRIPT_URL` in `src/App.jsx` if you ever redeploy the script.

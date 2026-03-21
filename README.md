# The Felt — Deployment Guide

## Before You Deploy — Two Things To Update

Open `src/app.js` and change these two lines at the top:

```js
const SITE_PASSWORD = "allin";         // ← the password everyone uses to sign up
const ADMIN_EMAIL = "dylan.r.minto@gmail.com";  // ← your email address
```

Your admin email must match exactly what you use to sign up on the live site.

---

## Deploy to Vercel (Free, ~5 minutes)

### Step 1 — GitHub account
Go to https://github.com and sign up (free) if you don't have one.

### Step 2 — Create a new repository
1. Click **+** → **New repository**
2. Name it: `thefelt`
3. Set to **Public**
4. Click **Create repository**

### Step 3 — Upload your files
1. On the repo page, click **uploading an existing file**
2. Drag and drop ALL contents of this zip:
   - `index.html`
   - `src/` folder (containing `style.css` and `app.js`)
3. Click **Commit changes**

### Step 4 — Deploy on Vercel
1. Go to https://vercel.com — sign in with GitHub
2. Click **Add New → Project**
3. Find your `thefelt` repo → click **Import**
4. Leave all settings as default → click **Deploy**
5. Wait ~30 seconds

### Step 5 — Your URL
Vercel gives you a URL like: **`thefelt-abc123.vercel.app`**

Share this with your group. They sign up using the club password.

---

## Adding New Quotes (After Launch)

1. Go to your `thefelt` repo on GitHub
2. Click `src/app.js`
3. Click the pencil ✏️ icon to edit
4. Find the `POKER_QUOTES` array
5. Add a new line anywhere inside it:
   ```js
   { text: "Your quote here.", attr: "Author Name" },
   ```
6. Click **Commit changes** — Vercel auto-redeploys in ~30 seconds

OR — log in as admin on the live site and use the **Admin → Quotes** panel to add/remove quotes without touching code.

---

## Summary of Features

| Feature | Who can use it |
|---|---|
| Sign up / sign in | Anyone with the club password |
| Start & run a game | Any logged-in player |
| Cash players out, save games | Any logged-in player |
| View history & leaderboard | Any logged-in player |
| Delete games | Admin only |
| Remove players | Admin only |
| Manage quotes | Admin only |

## Default Credentials (Demo — change before sharing)
- Club password: `allin`
- Admin email: set in `src/app.js`

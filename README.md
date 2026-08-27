# Budget Dashboard

A personal budget tracker: accounts, transactions, and category budgets (fixed $, % of income, or "whatever's left"), plus a "Needs Review" bucket for anything you're not sure how to categorize yet.

This is a template — a working starting point, not a finished product tied to anyone's specific setup. Make it yours: rename the accounts, change the categories, add your own rules.

## What you get out of the box

- **Accounts page** — track balances across multiple accounts (checking, savings, investing)
- **Transactions page** — add transactions manually, categorize them, and sort anything flagged as "Needs Review" into the right place
- **Budget page** — set a budget per category (a fixed dollar amount, a % of your income, or "whatever's left" after everything else), see what you've spent, and expand any category to see the actual transactions behind that number
- **Ignore/Include toggle** — exclude a specific transaction from a category's spending total without deleting it (e.g. a canceled subscription's last charge)

Everything above works immediately after setup, with transactions you enter by hand. Automatically syncing real bank transactions (via Plaid) is a separate, more advanced step — see the note at the bottom.

## Setup

You'll need your own **Supabase** project (this app's database — see step 1, do this first) and a place to run the app — **Vercel** is what this template is set up for.

### 1. Create a Supabase project

In your Supabase dashboard, create a new project. Once it's ready, open the **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql) — that creates the tables this app needs.

Then grab two values from **Project Settings → API**:
- **Project URL**
- **anon / public key** (not the service_role key — that one's more powerful and this app doesn't need it for the frontend)

### 2. Set your environment variables

Copy `.env.example` to `.env.local` and fill in the two values from step 1:

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run it locally

```bash
npm install
npm run dev
```

Open the local address it prints — you should see an empty dashboard, ready for your first transaction.

### 4. Deploy

The button below does steps 3-4 for you in one guided flow: it copies this code into a new GitHub repo under your own account, creates a Vercel project from it, and prompts you right there for the two values from step 1 — no separate copy/paste into settings needed.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/nwike2006-ops/budget-dashboard-template&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY&envDescription=From%20your%20Supabase%20project%3A%20Settings%20%E2%86%92%20API&project-name=budget-dashboard&repository-name=budget-dashboard)

(Prefer doing it by hand instead? Push this repo to your own GitHub account, then import it into Vercel — New Project → pick the repo — and add the same two environment variables in **Settings → Environment Variables** before your first deploy.)

**Optional — password-protect the deployed site.** Since this app has no per-user login (anyone with your Supabase anon key and URL could otherwise read/write your data — see `supabase/schema.sql`), `middleware.ts` can gate the whole site behind a single password. Add one more environment variable in Vercel to turn it on:

```
SITE_PASSWORD=whatever-you-want
```

Leave it unset and the site is open to anyone with the link — fine for testing, not recommended once it has real data in it.

## Making it yours

- **Accounts**: edit `src/data/budgetDefaults.js` (`DEFAULT_ACCOUNTS`) — or just rename/add them in the app itself once it's running.
- **Categories**: same file, `DEFAULT_CATEGORIES`. Add, remove, or rename to match how you actually think about your spending.
- **Auto-categorization rules**: `src/lib/spending.js` and `supabase/functions/_shared/syncTransactions.ts` have a couple of pattern-matching spots (commented, with examples) for teaching the app to recognize a specific recurring payee — useful once you're syncing real bank data.

## Connecting a real bank (optional, more involved)

This template supports syncing real transactions automatically via [Plaid](https://plaid.com), the same way the original build does — but that requires your own Plaid developer account, API keys, and (for real, non-sandbox accounts) Plaid's approval process, which is a bigger undertaking than the rest of this setup. The relevant code lives in `supabase/functions/` (`plaid-webhook`, `plaid-sync-transactions`, and related files) if you want to tackle it later. Until then, adding transactions by hand on the Transactions page works exactly the same.

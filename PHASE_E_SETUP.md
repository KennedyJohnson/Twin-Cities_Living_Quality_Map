# Phase E: Google Maps API Setup & Vercel Deployment

## Step 1: Create GCP Project and Enable Maps JavaScript API

### 1.1 Create a new GCP project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top-left (says "Select a project")
3. Click "NEW PROJECT"
4. Name: `st-paul-neighborhood-health` (or any descriptive name)
5. Organization: leave blank unless you have one
6. Click "CREATE"
7. Wait for project creation to complete (~30 seconds), then select it

### 1.2 Enable the Maps JavaScript API
1. In the Google Cloud Console, go to **APIs & Services > Library**
2. Search for "Maps JavaScript API"
3. Click the result
4. Click the blue "ENABLE" button
5. Wait for enablement (~1 minute)

### 1.3 Enable billing (required even for free tier)
1. Go to **APIs & Services > Credentials**
2. If you see a yellow notification "Click here to create credentials," ignore it for now
3. In the left sidebar, click **Billing**
4. Click "Link Billing Account"
5. Create or select an existing billing account
6. If creating: provide a credit card (Google offers $300 free credits for new accounts; Maps JavaScript API usage under free tier is minimal)
7. Confirm and link

### 1.4 Create an API key
1. Go to **APIs & Services > Credentials**
2. Click "Create Credentials" (top button) → "API Key"
3. A dialog shows your new API key (looks like `AIzaSyD...`); copy it to a temporary safe place
4. Click "Restrict Key"

### 1.5 Restrict API key (security best practice)
1. Under "Key restrictions," select **Application restrictions > HTTP referrers (web sites)**
2. In the text box, add your Vercel domain (once deployed):
   - For initial local testing: add `http://localhost:3000/*`
   - After Vercel deployment: add your Vercel URL (e.g., `https://st-paul-health.vercel.app/*`)
   - You can add both and modify later as needed
3. Under "API restrictions," select **Restrict key to specific Google APIs**
4. Search for and select "Maps JavaScript API"
5. Click "SAVE"

## Step 2: Configure locally for development

### 2.1 Create `.env.local` in `web/` directory
```bash
cd web/
cp .env.example .env.local
```

### 2.2 Edit `.env.local`
Replace the placeholder with your actual API key:
```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyD... (your key from Step 1.4)
```

### 2.3 Install Node dependencies and run dev server
```bash
npm install
npm run dev
```

The server will start at `http://localhost:3000`. Open it in a browser and verify:
- All 17 districts render with Blue–Orange shading
- Clicking a district opens the sidebar with metrics
- The legend shows the color scale
- No console errors about API key or missing data

## Step 3: Deploy to Vercel

### 3.1 Prepare for deployment
Ensure Phase B pipeline outputs are committed:
```bash
git status
```
Should show `web/public/data/neighborhoods.json` and `web/public/data/boundaries.geojson` already committed.

### 3.2 Push to GitHub
```bash
git add .
git commit -m "Phase E: Vercel deployment configuration"
git push origin main
```

### 3.3 Import project to Vercel
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New..." → "Project"
3. Import from Git → select your GitHub repository
4. Configure project:
   - **Project Name:** `st-paul-neighborhood-health` (or preferred name)
   - **Framework:** Next.js
   - **Root Directory:** `web/`
   - **Environment Variables:** Click "Add" and enter:
     - Key: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
     - Value: (paste your API key from Step 1.4)
   - Leave other settings as default
5. Click "Deploy"
6. Wait for deployment (~2–3 minutes)

### 3.4 Configure API key for production domain
Once Vercel deployment completes:
1. Copy your Vercel deployment URL (e.g., `https://st-paul-health.vercel.app`)
2. Go back to **Google Cloud Console > APIs & Services > Credentials**
3. Click your Maps API key
4. Under "HTTP referrers (web sites)," add:
   ```
   https://st-paul-health.vercel.app/*
   ```
5. Click "SAVE"

### 3.5 Verify live deployment
1. Visit your Vercel URL
2. Confirm all 17 districts render with correct coloring
3. Test interaction: click a district, verify sidebar loads
4. Check browser console (F12) for any errors

## Troubleshooting

### API key not working (blank map)
- Check browser console for error message
- Verify API key is correctly pasted in Vercel environment variables
- Verify Maps JavaScript API is enabled in GCP Console
- Verify HTTP referrer restrictions allow your domain

### Boundaries not loading
- Check Network tab in browser DevTools
- Verify `/data/boundaries.geojson` exists and loads (200 status)
- Verify `/data/neighborhoods.json` exists and loads (200 status)

### Districts not colored correctly
- Open browser DevTools Console, check for JavaScript errors
- Verify neighborhood data loaded by inspecting Redux/component state
- Confirm health_score values are numeric (0–100)

## Next: Phase F

Once deployment is confirmed working, proceed to Phase F: write the root `README.md` explaining the project to non-technical readers.

# Phase E: Frontend Setup & Vercel Deployment

## No API Key Needed!

This dashboard uses **Leaflet** with **OpenStreetMap**, which are completely free and open-source. No Google Cloud project, no credit card, no API keys required.

---

## Step 1: Install Dependencies Locally

```bash
cd web
npm install
```

This installs Leaflet, React Leaflet, and other required packages.

---

## Step 2: Run the Development Server

```bash
cd web
npm run dev
```

Open your browser to `http://localhost:3000`.

You should see:
- ✅ All 17 districts with blue-to-orange coloring (based on health scores)
- ✅ Click a district → sidebar opens with metrics
- ✅ Hover over districts for visual feedback
- ✅ Legend shows the color scale (Poor → Excellent)
- ✅ No console errors

---

## Step 3: Deploy to Vercel

### 3.1 Push to GitHub
```bash
git add .
git commit -m "Switch to Leaflet + OpenStreetMap (no API key needed)"
git push origin main
```

### 3.2 Import to Vercel
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New..." → "Project"
3. Select your GitHub repository
4. Configure:
   - **Project Name:** `st-paul-neighborhood-health`
   - **Framework:** Next.js
   - **Root Directory:** `web/`
   - **Environment Variables:** Leave empty (none needed!)
5. Click "Deploy"

### 3.3 Verify Live Deployment
Once deployment completes:
1. Visit your Vercel URL (e.g., `https://st-paul-health.vercel.app`)
2. Confirm the map renders correctly
3. Test click-through interaction
4. Verify no console errors

---

## How It Works

- **Map tiles:** OpenStreetMap (free, open-source, no rate limits)
- **Mapping library:** Leaflet (lightweight, no external API calls)
- **React integration:** react-leaflet (React components for Leaflet)
- **Data:** neighborhoods.json and boundaries.geojson (static files in `public/data/`)

Everything works client-side — no backend API needed.

---

## Troubleshooting

### Map is blank
- Check browser DevTools Console (F12) for errors
- Verify `/data/boundaries.geojson` loads (Network tab)
- Verify `/data/neighborhoods.json` loads (Network tab)

### Districts not colored
- Open DevTools Console, check for JavaScript errors
- Verify health_score values are numeric in neighborhoods.json

### Very slow to load
- This is normal on first visit; OpenStreetMap tiles cache in the browser
- Subsequent visits are instant

---

## Next: Phase F

The README.md is complete and explains the project to non-technical readers. You're done! 🎉

Your dashboard is ready to share:
1. Keep pipeline outputs committed (neighborhoods.json, boundaries.geojson)
2. Any time you regenerate the pipeline (`python pipeline/build.py`), commit the new JSON files
3. Vercel auto-deploys on every git push to main

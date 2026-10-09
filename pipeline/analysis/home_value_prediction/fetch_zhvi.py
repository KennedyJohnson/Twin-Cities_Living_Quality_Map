"""Stream Zillow ZHVI (ZIP, smoothed SFR+condo) and keep Hennepin/Ramsey
ZIPs, December value per year 2016-2025. Output: data/zhvi_zip.csv."""
import csv, io, urllib.request
from pathlib import Path

URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
OUT = Path(__file__).resolve().parent / "data" / "zhvi_zip.csv"
COUNTIES = {"Hennepin County", "Ramsey County"}

def main():
    with urllib.request.urlopen(URL, timeout=120) as r:
        rd = csv.DictReader(io.TextIOWrapper(r, encoding="utf-8"))
        dec = {y: f"{y}-12-31" for y in range(2016, 2026)}
        rows = []
        for row in rd:
            if row["State"] == "MN" and row["CountyName"] in COUNTIES:
                rows.append({"zip": row["RegionName"], "county": row["CountyName"],
                             **{f"zhvi_{y}": row.get(c, "") for y, c in dec.items()}})
    OUT.parent.mkdir(exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    print(len(rows), "ZIPs ->", OUT)

if __name__ == "__main__":
    main()

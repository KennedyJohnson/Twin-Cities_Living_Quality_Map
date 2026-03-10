# St. Paul Neighborhood Health Analysis
## Jupyter Notebook Index & Guide

Your complete analysis toolkit has been converted to interactive Jupyter notebooks! Follow this guide to work through your project step-by-step.

---

## 📓 The Notebooks (In Order)

### **1. 01_README.ipynb** — Getting Started Guide
**Purpose:** Introduction and project overview

**What you'll do:**
- Load and verify your datasets
- Explore the basic structure of each file
- Understand the four datasets at a glance
- Set up your analysis environment

**Key outcomes:**
- ✓ Datasets loaded successfully
- ✓ Column names identified
- ✓ Data quality assessed

**Time required:** 15-20 minutes

---

### **2. 02_EDA.ipynb** — Exploratory Data Analysis
**Purpose:** Deep dive into each dataset

**What you'll do:**
- Run detailed EDA on all four datasets
- Examine column structures, types, and missing values
- Identify neighborhood/geographic columns in each dataset
- Explore date ranges and temporal coverage
- Analyze categorical variables (offense types, issue types)
- Find data quality issues

**Key outputs:**
- ✓ Data shape summaries
- ✓ Missing value analysis
- ✓ Neighborhood column identification
- ✓ Date range documentation

**Time required:** 30-45 minutes

**Deliverable:** Document the neighborhood column names found in each dataset (you'll need these for cleaning!)

---

### **3. 03_Data_Cleaning.ipynb** — Data Standardization
**Purpose:** Prepare data for analysis

**What you'll do:**
- Create a neighborhood mapping dictionary
- Standardize neighborhood names across datasets
- Parse and standardize dates
- Extract years for analysis
- Validate key fields (offense types, issue types, costs)
- Remove duplicates and invalid records
- Generate quality report

**Key outputs:**
- ✓ Standardized neighborhoods across datasets
- ✓ Parsed and validated dates
- ✓ Data quality report
- ✓ Clean datasets ready for aggregation

**Time required:** 45-60 minutes

**Important:** This notebook requires you to update column names based on what you found in EDA (e.g., `NEIGHBORHOOD`, `ISSUE_DATE`, etc.)

---

### **4. 04_PROJECT_PLAN.ipynb** — Strategic Framework
**Purpose:** Understand the full project strategy

**What you'll do:**
- Review what each dataset tells you
- Understand the health indicators you'll calculate
- Learn the 5-phase analysis roadmap
- Explore key research questions
- See the expected outputs and timeline

**Key sections:**
- Dataset descriptions
- Health indicator definitions
- Research questions framework
- Analysis roadmap
- Success metrics

**Time required:** 30 minutes (read-through, little coding)

**Use this to:** Understand the "why" behind your analysis

---

### **5. 05_METHODOLOGY.ipynb** — Technical Deep Dive
**Purpose:** Detailed technical guidance

**What you'll do:**
- Learn exactly how to aggregate data
- Understand indicator calculation formulas
- See mathematical approaches for each index
- Review quality assurance steps
- Study statistical methods

**Key sections:**
- Data aggregation strategy (neighborhood-year summaries)
- Safety Index formula
- Development Index formula
- Service Need Index formula
- Composite Health Score formula
- Quality assurance checklist

**Time required:** 45 minutes (reference material)

**Use this to:** Implement the actual calculations

---

### **6. 06_CODE_SNIPPETS.ipynb** — Ready-to-Use Code
**Purpose:** Copy-paste ready implementation

**What you'll do:**
- Load and explore data
- Perform neighborhood aggregations
- Calculate rates per capita
- Build health indicators
- Create visualizations
- Export results

**Ready-to-run code for:**
- Loading datasets
- Aggregating by neighborhood-year
- Computing per capita rates
- Building indices
- Creating visualizations (bar charts, scatter plots, clustering)
- Exporting results to CSV

**Time required:** 60-90 minutes (implementation)

**Use this to:** Actually build your analysis

---

## 🎯 Recommended Workflow

### **Day 1: Understanding (1-2 hours)**
1. Open **01_README.ipynb** → Run all cells
2. Open **02_EDA.ipynb** → Run all cells, take notes on column names
3. Read **04_PROJECT_PLAN.ipynb** → Understand what you're building

### **Day 2: Data Prep (1-2 hours)**
4. Open **03_Data_Cleaning.ipynb** → Follow instructions, update column names
5. Complete all data cleaning steps
6. Save cleaned datasets

### **Day 3: Understanding Approach (30-45 min)**
7. Read **05_METHODOLOGY.ipynb** → Understand how to calculate metrics

### **Day 4-5: Implementation (2-3 hours)**
8. Open **06_CODE_SNIPPETS.ipynb** → Copy relevant sections
9. Adapt code to your cleaned data
10. Build aggregations, indices, and visualizations
11. Export results

### **Day 6: Analysis & Reporting (1-2 hours)**
12. Analyze your results
13. Create visualizations
14. Write findings

---

## 🔧 How to Use These Notebooks

### Basic Setup
```python
# 1. Install required libraries (if needed)
pip install pandas numpy matplotlib seaborn scikit-learn geopandas

# 2. In terminal/command line:
jupyter notebook

# 3. Navigate to notebooks folder
# 4. Click on 01_README.ipynb to start
```

### Running Notebooks
- **Cell types:**
  - 📝 **Markdown cells** = Explanations and instructions
  - 💻 **Code cells** = Python code to run
  
- **How to run:**
  - Click a cell
  - Press `Shift + Enter` to run it
  - Or click the ▶️ Run button

### Adapting Code to Your Data
Every code notebook has sections like:

```python
# ADJUST THESE COLUMN NAMES TO YOUR DATA:
permits['NEIGHBORHOOD_STANDARD'] = permits['NEIGHBORHOOD'].str.strip()
# If your column is named 'WARD' instead:
permits['NEIGHBORHOOD_STANDARD'] = permits['WARD'].str.strip()
```

**Key places to update:**
1. Column names (found in 02_EDA.ipynb output)
2. File paths (if data is in different location)
3. Neighborhood mappings (specific to your data)
4. Population estimates (if you have different source)

---

## 📊 Expected Outputs by Notebook

### After 01_README
- Confirmation that all datasets load
- Understanding of data size and complexity

### After 02_EDA
- List of neighborhood column names in each dataset
- Date ranges for each dataset
- Summary of data quality issues

### After 03_Data_Cleaning
- Clean datasets with standardized neighborhoods
- Count of neighborhoods across datasets
- Data quality report

### After 04_PROJECT_PLAN (reading)
- Understanding of research questions
- Knowledge of what health indicators to calculate
- Awareness of expected findings

### After 05_METHODOLOGY (reading)
- Understanding of calculation formulas
- Knowledge of aggregation approach
- Quality assurance checklist

### After 06_CODE_SNIPPETS
- **master_neighborhoods.csv** — All metrics by neighborhood-year
- **neighborhood_rankings.csv** — Health scores ranked
- **neighborhood_summary.csv** — Summary statistics
- Visualizations (charts showing trends and rankings)

---

## 💡 Tips & Tricks

### Notebook Shortcuts
- `Ctrl + /` = Comment/uncomment cell
- `Shift + Tab` = See function documentation
- `Tab` = Auto-complete suggestions
- `Esc` = Command mode, `Enter` = Edit mode

### Debugging
If a cell gives an error:
1. Read the error message carefully
2. Check that column names match your data
3. Check that file paths are correct
4. Verify data hasn't changed since last run
5. Try running cells in order (don't skip)

### Saving Progress
- **Save notebook:** `Ctrl + S` or File → Save
- **Export results:** Notebooks save CSVs to outputs/ folder
- **Keep backups:** Copy notebook before major changes

### Common Issues

**"FileNotFoundError: data/Approved_Building_Permits..."**
- Check that data folder exists
- Verify exact filename matches
- Run from correct directory

**"KeyError: 'NEIGHBORHOOD'"**
- Column name is different in your data
- Find correct name from 02_EDA output
- Update all references

**"ValueError: could not convert string to float"**
- Data type issue (string vs number)
- Use `pd.to_numeric(df['col'], errors='coerce')`

---

## 📋 Project Checklist

### Pre-Analysis
- [ ] All datasets loaded and explored (Notebook 01-02)
- [ ] Data cleaning completed (Notebook 03)
- [ ] Neighborhood columns standardized
- [ ] Date ranges documented
- [ ] Project plan reviewed (Notebook 04)

### Analysis Phase
- [ ] Methodology understood (Notebook 05)
- [ ] Code adapted to your data (Notebook 06)
- [ ] Aggregations created
- [ ] Indicators calculated
- [ ] Visualizations generated

### Post-Analysis
- [ ] Results exported to CSV
- [ ] Findings documented
- [ ] Neighborhoods ranked
- [ ] Trends analyzed
- [ ] Insights written up

---

## 🚀 Quick Start (TL;DR)

```python
# Copy this to run the minimal workflow:

# 1. Load data
import pandas as pd
perms = pd.read_csv('data/Approved_Building_Permits_-7890413957898939046.csv')
crime = pd.read_csv('data/Crime_Incident_Report.csv')
requests = pd.read_csv('data/Resident_Service_Requests_7024824928576740068.csv')

# 2. See what you have
print(perms.columns.tolist())
print(crime.columns.tolist())
print(requests.columns.tolist())

# 3. Then follow notebooks 01-06 in order
```

---

## 🎓 Learning Resources

**Within these notebooks:**
- All code is heavily commented
- Explanations are provided for each step
- Real examples shown for aggregation, indicators, visualization

**External resources:**
- Pandas documentation: https://pandas.pydata.org/docs/
- Matplotlib: https://matplotlib.org/
- Scikit-learn: https://scikit-learn.org/
- Jupyter: https://jupyter.org/

---

## 📧 Troubleshooting Flowchart

```
Issue: Notebook won't run
├─ Check: Is Jupyter installed?
│  └─ Run: pip install jupyter
├─ Check: Are data files present?
│  └─ Verify: data/ folder exists with all 4 files
└─ Check: Are column names correct?
   └─ Update: Use names from 02_EDA output

Issue: Different results than expected
├─ Check: Are you using cleaned data?
│  └─ Verify: Column standardizations applied
├─ Check: Is population data correct?
│  └─ Verify: Neighborhood mapping dictionary
└─ Check: Are formulas implemented correctly?
   └─ Review: 05_METHODOLOGY notebook

Issue: Code runs but seems wrong
├─ Check: Missing values handled?
│  └─ Try: Add .fillna(0) or .dropna()
├─ Check: Data types correct?
│  └─ Try: pd.to_numeric(col, errors='coerce')
└─ Check: Calculation logic?
   └─ Review: Manual spot-check 2-3 neighborhoods
```

---

## 📞 Getting Help

If stuck:
1. **Read the error message** - Usually tells you exactly what's wrong
2. **Check the notebook explanations** - Each code cell has markdown explanation
3. **Review METHODOLOGY notebook (05)** - Has detailed formula explanations
4. **Revisit EDA output (02)** - Verify your data structure
5. **Try CODE_SNIPPETS notebook (06)** - May have similar example

---

## ✅ Success Indicators

You've completed this successfully when:
- ✓ All notebooks run without errors
- ✓ You have master_neighborhoods.csv
- ✓ Health scores calculated for all neighborhoods
- ✓ You can explain the methodology to someone else
- ✓ Visualizations show clear patterns/trends
- ✓ Results make logical sense

---

## 🎉 You're Ready!

Start with **01_README.ipynb** and follow through the notebooks in order. Each builds on the previous, and you'll have a complete neighborhood health analysis by the end.

Good luck! 🚀


# ProcurePilot — Full Interactive Prototype

This is a deployable, front-end prototype of the full ProcurePilot concept.

## Included features
- CSV procurement data import
- Smart field-mapping preview
- Data cleaning / quality checks
- KPI-specific Analysis Readiness
- Procurement KPI overview
- Priority Exception Inbox
- PO-level Evidence Packet
- What Changed between imports
- Supplier performance comparison
- Predictive Supplier / PO Risk (transparent prototype score)
- Explainable risk factors
- Decision Reliability Score
- What-if supplier allocation simulator
- Evidence-grounded AI Copilot prototype
- AI Decision Advisor + Challenger behavior
- Decision Journal
- Outcome review
- Decision Memory Matching
- Personalized Dashboard Builder
- Rule view and Audit activity
- Human-in-the-loop decision design

## Run locally
You can simply open `index.html` in a browser, but a local web server is recommended because sample CSV loading uses fetch.

On macOS:
```bash
cd ProcurePilot_Full_Prototype
python3 -m http.server 8000
```

Then open:
http://127.0.0.1:8000

## Deploy to Vercel
1. Create a new GitHub repository.
2. Add all files in this folder.
3. Push to GitHub.
4. In Vercel: Add New -> Project -> Import the repository.
5. Framework preset: Other / Static.
6. Root directory: `./`
7. Deploy.

`vercel.json` is already included.

## Test the closed-loop workflow
1. Start with `sample_baseline.csv`.
2. Create a decision under Decisions & Outcomes.
3. Go to Import & Readiness and load `sample_followup.csv`.
4. Check:
   - What Changed
   - Priority Issues
   - Outcome review
   - Decision Memory
5. Use Dashboard Builder to create a personalized view.

## Important prototype notes
- The predictive risk score is a transparent deterministic prototype calculation, not a trained production ML model.
- The AI Copilot is a local evidence-grounded intent prototype, not an external LLM API.
- Decisions and dashboard settings are saved in the browser's localStorage.
- This makes the prototype easy to host on Vercel without needing a database or API key.
- A production version can replace these prototype components with:
  - trained ML models,
  - a controlled LLM tool layer,
  - PostgreSQL,
  - user authentication,
  - server-side audit logs,
  - direct read-only ERP/SAP integration.

## Human-in-the-loop principle
ProcurePilot can detect, predict, explain, compare and recommend. It does not autonomously approve POs, change supplier allocation, or write back to SAP.

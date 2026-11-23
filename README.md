# CareerOS

Full-stack job application tracker, interview pipeline manager, and visual document vault powered by automated Gmail and Gemini API email parsing.

## Screenshots

<img width="2752" height="1526" alt="Screenshot 2026-11-23 195727" src="https://github.com/user-attachments/assets/30839900-b206-4527-b910-e2307788d48d" />

<img width="2722" height="1394" alt="Screenshot 2026-11-23 195700" src="https://github.com/user-attachments/assets/a85eb160-9525-4e32-8900-ecaa8793caef" />

<!-- ![Document Vault](docs/screenshots/vault.png) -->

## Tech Stack

* **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, PDF.js
* **Backend:** Python, FastAPI, Uvicorn
* **Database & Storage:** Supabase (PostgreSQL, Row Level Security, Private Storage Buckets)
* **Integrations:** Gmail API (OAuth 2.0), Google Gemini API

## Key Features

* **Automated Inbox Triage:** Polls recruiter and ATS emails via the Gmail API and uses structured Gemini API extraction to classify incoming leads and update application stages automatically.
* **Three-Mode Workspace:**
  * `/pipeline` — Interactive Kanban board tracking applications from lead to offer.
  * `/vault` — Visual PDF thumbnail grid for CVs, cover letters, and academic transcripts with instant quick-grab copying.
  * `/insights` — Application velocity, stage conversion, and response-rate analytics.
* **Global Job Drawer:** Slide-over detail panel linking each application to its tailored CV version, job description notes, and email thread history.

## Quick Setup

1. **Clone the repository**
   ```bash
   git clone [https://github.com/Tsosang1/career-os.git](https://github.com/Tsosang1/career-os.git)
   cd career-os

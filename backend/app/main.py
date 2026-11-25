import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import emails

app = FastAPI(title="CareerOS Intelligence Engine", version="1.0.0")

allowed_origins = [
    "http://localhost:3000",
    os.getenv("FRONTEND_URL", "").rstrip("/"),
]
allowed_origins = [o for o in allowed_origins if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(emails.router)

@app.get("/health")
def health_check():
    return {"status": "ok"}

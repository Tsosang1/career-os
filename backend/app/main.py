from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import emails

app = FastAPI(title="CareerOS Intelligence Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(emails.router)

@app.get("/health")
def health_check():
    return {"status": "ok"}

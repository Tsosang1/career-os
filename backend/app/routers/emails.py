from fastapi import APIRouter, HTTPException
from app.schemas import SyncRequest, SyncResponse
from app.services.gmail_worker import run_gmail_sync

router = APIRouter(prefix="/emails", tags=["emails"])

@router.post("/sync", response_model=SyncResponse)
def sync_emails(payload: SyncRequest):
    try:
        result = run_gmail_sync(user_id=payload.user_id, max_results=payload.max_results)
        return SyncResponse(**result)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Sync failed: {exc}")

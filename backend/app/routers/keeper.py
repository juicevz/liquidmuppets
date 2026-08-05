from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from app.database import Database, KeeperRunRecord
from app.schemas import KeeperRunRequest, KeeperRunResponse

router = APIRouter(tags=["keeper"])


@router.post("/keeper/run", response_model=KeeperRunResponse)
def run_keeper(payload: KeeperRunRequest, request: Request) -> KeeperRunResponse:
    chain = request.app.state.chain
    database = request.app.state.database
    try:
        state, preview, tx_hash, status = chain.run_keeper(payload.vault)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"chain call failed: {type(error).__name__}") from error

    database.add_keeper_run(
        KeeperRunRecord(
            vault=state.vault,
            task_id=state.task_id,
            action=preview.action,
            amount=str(preview.amount),
            reason=preview.reason,
            status=status,
            tx_hash=tx_hash,
        )
    )
    return KeeperRunResponse(
        vault=state.vault,
        action=preview.action,
        amount=preview.amount,
        reason=preview.reason,
        tx_hash=tx_hash,
        status=status,
    )


@router.get("/keeper/runs")
def keeper_runs(request: Request, limit: int = Query(default=50, ge=1, le=200)) -> list[dict[str, object]]:
    database: Database = request.app.state.database
    return database.list_keeper_runs(limit)

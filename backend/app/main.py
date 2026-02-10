from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from app.api import upload, analysis, sessions, export, db
from app.core.auth import verify_api_key
from app.core.config import settings
from app.core.error_handling import http_exception_handler, unhandled_exception_handler, validation_exception_handler
from fastapi import HTTPException

app = FastAPI(title="AI Data Analysis API")

# Configure CORS
allow_origins = [o.strip() for o in (getattr(settings, "CORS_ALLOW_ORIGINS", "") or "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins or ["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/api/"):
            verify_api_key(request)
        resp: Response = await call_next(request)
        return resp

app.add_middleware(ApiKeyMiddleware)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(analysis.router, prefix="/api", tags=["analysis"])
app.include_router(sessions.router, prefix="/api", tags=["sessions"])
app.include_router(export.router, prefix="/api", tags=["export"])
app.include_router(db.router, prefix="/api", tags=["db"])

@app.get("/")
def read_root():
    return {"message": "Welcome to AI Data Analysis API"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

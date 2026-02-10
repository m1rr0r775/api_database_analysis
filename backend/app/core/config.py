import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    AI_PROVIDER = os.getenv("AI_PROVIDER", "deepseek")
    AI_API_KEY = os.getenv("AI_API_KEY", "")
    AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1")
    AI_MODEL_NAME = os.getenv("AI_MODEL_NAME", "deepseek-chat")
    AI_CONTEXT_ROWS = int(os.getenv("AI_CONTEXT_ROWS", "10"))
    UPLOAD_PREVIEW_ROWS = int(os.getenv("UPLOAD_PREVIEW_ROWS", "10"))
    UPLOAD_MAX_BYTES = int(os.getenv("UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))
    UPLOAD_ALLOWED_EXT = os.getenv("UPLOAD_ALLOWED_EXT", ".csv,.xls,.xlsx")
    DB_ENCRYPTION_KEY = os.getenv("DB_ENCRYPTION_KEY", "")
    DB_QUERY_PREVIEW_ROWS = int(os.getenv("DB_QUERY_PREVIEW_ROWS", "1000"))
    DB_QUERY_SAVE_MAX_ROWS = int(os.getenv("DB_QUERY_SAVE_MAX_ROWS", "100000"))
    DB_QUERY_TIMEOUT_SECONDS = int(os.getenv("DB_QUERY_TIMEOUT_SECONDS", "15"))
    CORS_ALLOW_ORIGINS = os.getenv("CORS_ALLOW_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
    API_KEY = os.getenv("API_KEY", "")
    DATA_DIR = os.getenv("DATA_DIR", "")

settings = Settings()

import uvicorn
import os
import sys

# Add the current directory to sys.path to ensure module resolution works
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    # Reload=True helps during development
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)

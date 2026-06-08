#!/bin/bash
# Quantio startup script

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3.12 -m venv venv
fi

# Activate venv
source venv/bin/activate

# Install/update dependencies
echo "Installing dependencies..."
pip install -r requirements.txt -q

# Copy .env if it doesn't exist
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "Created .env from .env.example — edit it to set your SECRET_KEY"
fi

# Create data directory
mkdir -p data

# Start server
echo "Starting Quantio at http://localhost:8000"
uvicorn app:app --host 0.0.0.0 --port 8000 --reload

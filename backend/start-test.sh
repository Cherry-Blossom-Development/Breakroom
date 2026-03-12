#!/bin/bash
# Start backend server with test database configuration
# Used for running automated tests

cd "$(dirname "$0")"

# Tell dotenv to load from .env.test instead of .env
export DOTENV_CONFIG_PATH=../.env.test

# Override port for test server
export PORT=3001

echo "Starting test backend server on port $PORT..."
echo "Using config: $DOTENV_CONFIG_PATH"

node index.js

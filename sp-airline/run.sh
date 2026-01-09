#!/bin/bash

echo "Starting Airline Mock Service..."

# Check if Java is installed
if ! command -v java &> /dev/null; then
    echo "Error: Java is not installed or not in PATH"
    exit 1
fi

# Check if Maven is installed
if ! command -v mvn &> /dev/null; then
    echo "Error: Maven is not installed or not in PATH"
    exit 1
fi

# Build the project
echo "Building the project..."
mvn clean install -DskipTests

if [ $? -ne 0 ]; then
    echo "Error: Build failed"
    exit 1
fi

# Run the service
echo "Starting the service on port 8081..."
echo "Service will be available at: http://localhost:8081/airline-api/v1/health"
echo "Press Ctrl+C to stop the service"

mvn spring-boot:run

#!/bin/bash

# Script to build, tag, and push Docker image to Google Container Registry
# Usage: ./build-and-push.sh <version>
# Example: ./build-and-push.sh v2.1.73

set -e  # Exit on any error

# Check if version argument is provided
if [ $# -eq 0 ]; then
    echo "Error: Version number is required"
    echo "Usage: $0 <version>"
    echo "Example: $0 v2.1.73"
    exit 1
fi

VERSION=$1
IMAGE_NAME="demo-ota"
REGISTRY="gcr.io/cs-poc-sasxbttlzroculpau4u6e2l"
FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}:${VERSION}"

echo "🚀 Starting Docker build and push process..."
echo "📦 Image: ${FULL_IMAGE_NAME}"
echo "🏷️  Version: ${VERSION}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running or not accessible"
    exit 1
fi

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Error: Not authenticated with Google Cloud. Please run 'gcloud auth login' first"
    exit 1
fi

# Configure Docker to use gcloud as a credential helper
echo "🔐 Configuring Docker authentication with Google Cloud..."
gcloud auth configure-docker

echo "🔨 Building Docker image..."
mvn clean package
docker build --platform linux/amd64 -t ${IMAGE_NAME}:${VERSION} .

echo "🏷️  Tagging image for Google Container Registry..."
docker tag ${IMAGE_NAME}:${VERSION} ${FULL_IMAGE_NAME}

echo "📤 Pushing image to Google Container Registry..."
docker push ${FULL_IMAGE_NAME}

echo "✅ Successfully built and pushed ${FULL_IMAGE_NAME}"

# Clean up local tags
echo "🧹 Cleaning up local tags..."
docker rmi ${IMAGE_NAME}:${VERSION} ${FULL_IMAGE_NAME}

echo "🎉 Done! Image ${FULL_IMAGE_NAME} is now available in Google Container Registry"

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --disable-pip-version-check -r requirements.txt
COPY forwarder.py ./forwarder.py

# The mounted token must be readable by this UID (or an explicit runtime UID).
USER 65532:65532
EXPOSE 4319
HEALTHCHECK --interval=10s --timeout=3s --start-period=2s --retries=3 \
    CMD ["python", "-c", "import http.client,sys; c=http.client.HTTPConnection('127.0.0.1',4319,timeout=2); c.request('GET','/healthz'); sys.exit(c.getresponse().status != 200)"]
CMD ["python", "forwarder.py"]

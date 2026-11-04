import { RecordSdk } from "@softprobe/web-record";
import type { RecordingUploadStatus, WebRecordController } from "@softprobe/web-record";

type CaptureConfig = {
  apiKey: string;
  captureId: string;
  baseUrl: string;
  apiOrigins: string[];
  environment?: string;
  maskAllInputs: true;
  maskTextSelectors: string[];
  blockSelectors: string[];
};

declare global {
  interface Window {
    __softprobeCapture?: WebRecordController;
    __softprobeCaptureReady?: boolean;
  }
}

function setCaptureStatus(status: RecordingUploadStatus | "disabled" | "failed"): void {
  document.documentElement.dataset.softprobeCaptureStatus = status;
}

async function initializeCapture(): Promise<void> {
  try {
    const response = await fetch("/api/capture/config", { cache: "no-store" });
    if (response.status === 404) {
      setCaptureStatus("disabled");
      return;
    }
    if (!response.ok) throw new Error("capture configuration unavailable");

    const config = await response.json() as CaptureConfig;
    const controller = RecordSdk.init({
      apiKey: config.apiKey,
      captureId: config.captureId,
      baseUrl: config.baseUrl,
      apiOrigins: config.apiOrigins,
      environment: config.environment,
      serviceName: "travel-ota-web",
      maskAllInputs: true,
      ...(config.maskTextSelectors.length
        ? { maskTextSelector: config.maskTextSelectors.join(",") }
        : {}),
      ...(config.blockSelectors.length
        ? { blockSelector: config.blockSelectors.join(",") }
        : {}),
      onUploadStatus: setCaptureStatus,
    });
    window.__softprobeCapture = controller;
    window.__softprobeCaptureReady = true;
  } catch {
    setCaptureStatus("failed");
    window.__softprobeCaptureReady = true;
  }
}

void initializeCapture();

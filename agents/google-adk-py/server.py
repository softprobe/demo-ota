import asyncio
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
import httpx
import uvicorn

HERE = Path(__file__).resolve().parent
HOST = os.environ.get("AGENT_HOST", "127.0.0.1")
PORT = int(os.environ.get("AGENT_PORT", "4311"))
OTA_BASE_URL = os.environ.get("TRAVEL_OTA_BASE_URL", "http://127.0.0.1:8081").rstrip("/")
CONTRACTS_DIR = Path(os.environ.get("CONTRACTS_DIR") or ("/opt/contracts" if Path("/opt/contracts/travel-policies.json").exists() else str(HERE / "../../contracts")))

SYSTEM_PROMPT = (CONTRACTS_DIR / "agent-system-prompt.txt").read_text(encoding="utf-8").strip()
TRAVEL_POLICY = json.loads((CONTRACTS_DIR / "travel-policies.json").read_text(encoding="utf-8"))
TOOL_DESCRIPTIONS = {t["name"]: t["description"] for t in json.loads((CONTRACTS_DIR / "agent-tools.schema.json").read_text(encoding="utf-8"))["tools"]}

PROVIDERS = {
    "google": {"label": "Google Gemini", "defaultModel": "gemini-2.5-flash"},
    "openai": {"label": "OpenAI", "defaultModel": "gpt-4.1-mini"},
    "anthropic": {"label": "Anthropic", "defaultModel": "claude-sonnet-4-5"},
    "compatible": {"label": "OpenAI-compatible", "defaultModel": "local-model"},
}
SECRET_KEYS = ("GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GEMINI_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "AI_COMPATIBLE_API_KEY")
MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
NAME_REPLY_RE = re.compile(r"^[A-Za-z][A-Za-z' -]{0,9}\s+[A-Za-z][A-Za-z' -]{0,9}$")
ALL_TOOLS = ["travel_search", "travel_prepare", "travel_book", "travel_order"]
APP_NAME, USER_ID = "demo-ota", "traveler"

trace_headers_var: ContextVar[dict[str, str]] = ContextVar("trace_headers", default={})
session_service = InMemorySessionService()
sessions: dict[str, dict[str, Any]] = {}


class ApiError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def clean_error(exc: BaseException) -> str:
    msg = str(exc) or "The model request failed."
    for k in SECRET_KEYS:
        if os.environ.get(k):
            msg = msg.replace(os.environ[k], "[redacted]")
    return msg[:500]


def google_key() -> str:
    return os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY") or os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI_KEY") or ""


def compatible_url() -> str | None:
    raw = (os.environ.get("AI_COMPATIBLE_BASE_URL") or "").strip()
    p = urlparse(raw) if raw else None
    if not p or p.scheme not in ("http", "https") or not p.netloc or p.username or p.password or p.query or p.fragment:
        return None
    return raw.rstrip("/")


def configured_providers() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if google_key():
        out.append({"id": "google", **PROVIDERS["google"]})
    if os.environ.get("OPENAI_API_KEY"):
        out.append({"id": "openai", **PROVIDERS["openai"]})
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        out.append({"id": "anthropic", **PROVIDERS["anthropic"]})
    if compatible_url():
        out.append({"id": "compatible", **PROVIDERS["compatible"]})
    return out


def resolve_selection(req_prov: Any = None, req_model: Any = None) -> tuple[str, str]:
    avail = configured_providers()
    def_prov = next((p["id"] for p in avail if p["id"] == os.environ.get("TRAVEL_PROVIDER")), avail[0]["id"] if avail else None)
    def_model = (os.environ.get("TRAVEL_MODEL") or PROVIDERS[def_prov]["defaultModel"]) if def_prov else ""
    prov = req_prov.strip() if isinstance(req_prov, str) and req_prov.strip() else def_prov
    if not prov or prov not in PROVIDERS:
        raise ApiError("Choose a supported model provider.")
    if not any(p["id"] == prov for p in avail):
        raise ApiError(f"Configure the {PROVIDERS[prov]['label']} API key on this server before selecting it.")
    model = req_model.strip() if isinstance(req_model, str) and req_model.strip() else (def_model if prov == def_prov else PROVIDERS[prov]["defaultModel"])
    if not MODEL_ID_RE.match(model):
        raise ApiError("Enter a valid model ID.")
    return prov, model


def build_adk_model(provider: str, model_id: str) -> Any:
    if provider == "google":
        if google_key() and not os.environ.get("GOOGLE_API_KEY"):
            os.environ["GOOGLE_API_KEY"] = google_key()
        return model_id
    if provider == "openai":
        return LiteLlm(model=model_id if model_id.startswith("openai/") else f"openai/{model_id}", api_key=os.environ.get("OPENAI_API_KEY"))
    if provider == "anthropic":
        return LiteLlm(model=model_id if model_id.startswith("anthropic/") else f"anthropic/{model_id}", api_key=os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
    return LiteLlm(model=model_id if "/" in model_id else f"openai/{model_id}", api_base=compatible_url(), api_key=os.environ.get("AI_COMPATIBLE_API_KEY") or "local")


def system_prompt_for_today() -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"{SYSTEM_PROMPT}\nCurrent date (UTC): {today}. Resolve yearless month/day dates using this date. Search at most once per user travel request; reuse the latest matching search results when the user selects an option or supplies their name. If the app supplies a selected offerId, prepare that exact offer after collecting any missing name; a name reply is never a reason to search again. If no matching search result exists yet, search once when origin, destination, and date are known. After travel_prepare succeeds, stop using tools and say briefly that the review is ready in the trip panel."


async def ota_request(method: str, path: str, body: dict[str, Any] | None = None, timeout: float = 30.0) -> tuple[int, dict[str, Any]]:
    headers = {**trace_headers_var.get(), "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        resp = await client.request(method, f"{OTA_BASE_URL}{path}", headers=headers, json=body)
    if not resp.text:
        return resp.status_code, {}
    try:
        parsed = resp.json()
        return resp.status_code, parsed if isinstance(parsed, dict) else {"result": parsed}
    except ValueError:
        return resp.status_code, {"error": resp.text[:300]}


async def parse_json(request: Request, allowed: set[str]) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > 16_384:
        raise ApiError("Request body is too large.", 413)
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except ValueError as exc:
        raise ApiError("Malformed JSON.") from exc
    if not isinstance(data, dict) or any(k not in allowed for k in data):
        raise ApiError("Invalid or unexpected JSON fields.")
    return data


def get_session(sid: str) -> dict[str, Any]:
    if sid not in sessions:
        raise ApiError("This travel conversation was not found.", 404)
    return sessions[sid]


async def execute_turn(session: dict[str, Any], prompt_text: str, allowed_names: list[str]) -> None:
    if session["busy"]:
        raise ApiError("Wait for the current response or stop it first.", 409)
    turn_tools: list[dict[str, str]] = []
    prepared = False
    sid = session["id"]

    async def invoke(name: str, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        nonlocal prepared
        status, data = await ota_request("POST", f"/api/bookings/sessions/{sid}/tools/{suffix}", payload)
        if status >= 400:
            turn_tools.append({"name": name, "status": "error"})
            return {"error": data.get("error") if isinstance(data.get("error"), str) else f"Travel operation failed (HTTP {status})."}
        turn_tools.append({"name": name, "status": "completed"})
        if name == "travel_prepare":
            prepared = True
        return data

    async def travel_search(origin: str, destination: str, date: str) -> dict[str, Any]:
        return await invoke("travel_search", "search", {"origin": origin, "destination": destination, "date": date})

    async def travel_prepare(offerId: str, firstName: str, lastName: str) -> dict[str, Any]:
        return await invoke("travel_prepare", "prepare", {"offerId": offerId, "firstName": firstName, "lastName": lastName})

    async def travel_book(requestId: str) -> dict[str, Any]:
        return await invoke("travel_book", "book", {"requestId": requestId})

    async def travel_order() -> dict[str, Any]:
        return await invoke("travel_order", "order", {})

    fn_map = {"travel_search": travel_search, "travel_prepare": travel_prepare, "travel_book": travel_book, "travel_order": travel_order}
    for k, fn in fn_map.items():
        fn.__doc__ = TOOL_DESCRIPTIONS[k]

    def stop_after_prepare(_ctx: Any, _req: Any) -> LlmResponse | None:
        if not prepared:
            return None
        return LlmResponse(content=types.Content(role="model", parts=[types.Part.from_text(text="The review is ready in the trip panel.")]))

    agent = LlmAgent(name="travel_agent", model=build_adk_model(session["provider"], session["model"]), instruction=system_prompt_for_today(), tools=[fn_map[n] for n in allowed_names], before_model_callback=stop_after_prepare)
    runner = Runner(app_name=APP_NAME, agent=agent, session_service=session_service)

    async def run_adk() -> str:
        latest = ""
        msg = types.Content(role="user", parts=[types.Part.from_text(text=prompt_text)])
        async for ev in runner.run_async(user_id=USER_ID, session_id=sid, new_message=msg):
            if getattr(ev, "partial", False) or ev.author != "travel_agent" or not ev.content or not ev.content.parts:
                continue
            texts = [p.text.strip() for p in ev.content.parts if getattr(p, "text", None) and p.text.strip()]
            if texts:
                latest = "\n".join(texts)
        return latest

    session.update(busy=True, used=True, lastError=None)
    session["messages"].append({"id": str(uuid4()), "role": "user", "text": prompt_text, "tools": []})
    task = asyncio.create_task(run_adk())
    session["task"] = task

    try:
        raw = await task
        if prepared:
            session["selectedOfferId"] = None
        session["messages"].append({"id": str(uuid4()), "role": "assistant", "text": "The review is ready in the trip panel." if (prepared and not raw) else raw, "tools": turn_tools})
    except asyncio.CancelledError as exc:
        session["lastError"] = "The user stopped this agent turn."
        raise ApiError(session["lastError"], 409) from exc
    except Exception as exc:
        session["lastError"] = clean_error(exc)
        raise ApiError(session["lastError"], 502) from exc
    finally:
        session.update(busy=False, task=None)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def gateway_middleware(request: Request, call_next):
    path = request.scope.get("path", "")
    if path == "/agent/api" or path.startswith("/agent/api/"):
        request.scope["path"] = path[len("/agent"):]
    inbound = {k: request.headers[k].strip() for k in ("traceparent", "tracestate", "baggage") if request.headers.get(k, "").strip()}
    token = trace_headers_var.set(inbound)
    try:
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp
    finally:
        trace_headers_var.reset(token)


@app.exception_handler(ApiError)
async def handle_api_error(_req: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": clean_error(exc)}, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@app.get("/api/status")
async def status_endpoint() -> dict[str, Any]:
    providers = configured_providers()
    def_prov = next((p["id"] for p in providers if p["id"] == os.environ.get("TRAVEL_PROVIDER")), providers[0]["id"] if providers else None)
    def_model = (os.environ.get("TRAVEL_MODEL") or PROVIDERS[def_prov]["defaultModel"]) if def_prov else ""
    travel = False
    for probe in ("/index.html", "/"):
        try:
            st, _ = await ota_request("GET", probe, timeout=2.0)
            if 200 <= st < 300:
                travel = True
                break
            if st != 404:
                break
        except httpx.HTTPError:
            break
    return {
        "ready": bool(providers) and travel, "runtime": True, "runtimeFlavor": "google-adk-py", "providers": providers,
        "defaultProvider": def_prov, "defaultModel": def_model, "model": f"{def_prov}/{def_model}" if def_prov else "No provider configured",
        "travel": travel, "environment": "local synthetic demo", "defaultDate": (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d"),
        "conversationLimit": None, "conversationsUsed": sum(1 for s in sessions.values() if s["used"]),
    }


@app.post("/api/sessions", status_code=201)
async def create_session_endpoint(request: Request) -> dict[str, Any]:
    body = await parse_json(request, {"provider", "model"})
    provider, model = resolve_selection(body.get("provider"), body.get("model"))
    sid = f"ses_{uuid4()}"
    st, data = await ota_request("GET", f"/api/bookings/sessions/{sid}")
    if st >= 400:
        raise ApiError(data.get("error") or f"Travel service returned HTTP {st}.", 502)
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=sid)
    sessions[sid] = {"id": sid, "provider": provider, "model": model, "messages": [], "selectedOfferId": None, "busy": False, "lastError": None, "used": False, "task": None}
    return {"id": sid, "provider": provider, "model": model}


@app.get("/api/sessions/{sid}")
async def get_session_endpoint(sid: str) -> dict[str, Any]:
    s = get_session(sid)
    st, data = await ota_request("GET", f"/api/bookings/sessions/{sid}")
    if st >= 400:
        raise ApiError(data.get("error") or f"Travel service returned HTTP {st}.", 502)
    return {
        "id": s["id"], "provider": s["provider"], "model": s["model"], "messages": s["messages"], "busy": s["busy"],
        "offers": data.get("offers") or [], "pending": data.get("pending"), "booking": data.get("booking"),
        "travelPolicy": data.get("travelPolicy") or TRAVEL_POLICY, "lastError": s["lastError"],
    }


@app.post("/api/sessions/{sid}/messages")
async def post_message_endpoint(sid: str, request: Request) -> dict[str, Any]:
    s = get_session(sid)
    body = await parse_json(request, {"text", "offerId"})
    text = body.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        raise ApiError("Enter a message of 1-4000 characters.")
    if s["busy"]:
        raise ApiError("Wait for the current response or stop it first.", 409)
    st, data = await ota_request("GET", f"/api/bookings/sessions/{sid}")
    if st >= 400:
        raise ApiError(data.get("error") or f"Travel service returned HTTP {st}.", 502)
    prompt, offer_id = text.strip(), body.get("offerId")
    if offer_id is not None:
        if not isinstance(offer_id, str) or not any(o.get("id") == offer_id for o in (data.get("offers") or [])):
            raise ApiError("Choose a flight returned by this conversation.", 404)
        s["selectedOfferId"] = offer_id
    elif s["selectedOfferId"] and not NAME_REPLY_RE.match(prompt):
        s["selectedOfferId"] = None
    pending = data.get("pending")
    restricted = isinstance(pending, dict) and pending.get("status") in {"completed", "submitting", "uncertain"}
    allowed = ["travel_order"] if restricted else ([t for t in ALL_TOOLS if t != "travel_search"] if s["selectedOfferId"] else ALL_TOOLS)
    await execute_turn(s, prompt, allowed)
    return {"accepted": True, "completed": True}


@app.post("/api/sessions/{sid}/approve")
async def approve_endpoint(sid: str, request: Request) -> dict[str, Any]:
    s = get_session(sid)
    body = await parse_json(request, {"requestId", "injectSilentBug"})
    if s["busy"]:
        raise ApiError("Wait for the current response or stop it first.", 409)
    req_id, inject = body.get("requestId"), body.get("injectSilentBug")
    if not isinstance(req_id, str) or not UUID_RE.match(req_id) or (inject is not None and not isinstance(inject, bool)):
        raise ApiError("Invalid approval parameters.")
    st, data = await ota_request("POST", f"/api/bookings/sessions/{sid}/approve", {"requestId": req_id, "injectSilentBug": inject is True})
    if st >= 400:
        raise ApiError(data.get("error") or f"Approval failed (HTTP {st}).", st)
    if data.get("awaitingManagerApproval") is True:
        return {"accepted": True, "awaitingManagerApproval": True}
    tpl = TRAVEL_POLICY["silentBugContinuationTemplate"] if inject is True else TRAVEL_POLICY["confirmContinuationTemplate"]
    await execute_turn(s, tpl.replace("{{requestId}}", req_id), ["travel_book", "travel_order"])
    return {"accepted": True, "awaitingManagerApproval": False, "completed": True}


@app.post("/api/sessions/{sid}/pay")
async def pay_endpoint(sid: str, request: Request) -> dict[str, Any]:
    s = get_session(sid)
    req_id = (await parse_json(request, {"requestId"})).get("requestId")
    if s["busy"]:
        raise ApiError("Wait for the current agent action before paying.", 409)
    if not isinstance(req_id, str) or not UUID_RE.match(req_id):
        raise ApiError("A valid booking requestId is required.")
    st, data = await ota_request("POST", f"/api/bookings/sessions/{sid}/pay", {"requestId": req_id})
    if st >= 400:
        raise ApiError(data.get("error") or f"Payment failed (HTTP {st}).", st)
    return {"paid": True, "booking": data.get("booking")}


@app.post("/api/sessions/{sid}/cancel-booking")
async def cancel_endpoint(sid: str, request: Request) -> dict[str, Any]:
    s = get_session(sid)
    req_id = (await parse_json(request, {"requestId"})).get("requestId")
    if s["busy"]:
        raise ApiError("Stop the current agent turn before canceling the review.", 409)
    if not isinstance(req_id, str) or not UUID_RE.match(req_id):
        raise ApiError("A valid booking requestId is required.")
    st, data = await ota_request("POST", f"/api/bookings/sessions/{sid}/cancel", {"requestId": req_id})
    if st >= 400:
        raise ApiError(data.get("error") or f"Cancel failed (HTTP {st}).", st)
    return {"cancelled": True}


@app.post("/api/sessions/{sid}/abort")
async def abort_endpoint(sid: str, request: Request) -> dict[str, Any]:
    s = get_session(sid)
    await parse_json(request, set())
    if s["busy"] and s["task"] is not None:
        s["task"].cancel()
        await asyncio.gather(s["task"], return_exceptions=True)
        s["busy"] = False
    return {"stopped": True}


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")

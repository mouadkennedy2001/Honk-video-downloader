"""Headless yt-dlp engine bundled inside the Android APK by Chaquopy.

Every public function returns a JSON string so the Java bridge can hand it to
JavaScript. Long-running downloads emit Capacitor events through ProgressBridge.
No HTTP server, socket or external process is used.
"""

from __future__ import annotations

import atexit
import json
import os
import threading
import time
import traceback

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

try:  # Chaquopy exposes the Java package to Python.
    from app.wasel.downloader.ProgressBridge import ProgressBridge
except ImportError:  # Allows local syntax checks outside Android.
    ProgressBridge = None  # type: ignore[assignment]


_DOWNLOADS: dict[str, dict] = {}
_LOCK = threading.RLock()
_DEFAULT_DIR = os.path.join(os.path.expanduser("~"), "WaselDownloads")


def _json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _emit(event_type: str, payload: dict) -> None:
    if ProgressBridge is None:
        return
    body = dict(payload)
    body["type"] = event_type
    try:
        ProgressBridge.emit(_json(body))
    except Exception:
        # WebView may not be attached yet; never crash the Python thread.
        pass


def _summarize(data: dict, url: str) -> dict:
    formats = data.get("formats") or []
    entries = data.get("entries") or []
    thumbnails = data.get("thumbnails") or []

    sources = formats or [
        fmt for entry in entries if isinstance(entry, dict)
        for fmt in (entry.get("formats") or [])
    ]
    heights = sorted(
        {
            int(f.get("height"))
            for f in sources
            if f.get("height") and f.get("vcodec") not in (None, "none")
        },
        reverse=True,
    )

    thumbnail = (
        data.get("thumbnail")
        or (thumbnails[-1].get("url") if thumbnails and isinstance(thumbnails[-1], dict) else None)
        or next((e.get("thumbnail") for e in entries if isinstance(e, dict) and e.get("thumbnail")), None)
    )

    subtitle_langs = list(
        {*(data.get("subtitles") or {}).keys(), *(data.get("automatic_captions") or {}).keys()}
    )[:30]

    playlist_count = (
        int(data.get("playlist_count") or len(entries))
        if data.get("_type") == "playlist" or entries
        else 0
    )

    return {
        "id": data.get("id"),
        "title": data.get("title") or data.get("fulltitle") or "فيديو بدون عنوان",
        "thumbnail": thumbnail,
        "duration": data.get("duration"),
        "uploader": data.get("uploader") or data.get("channel") or data.get("creator"),
        "webpageUrl": data.get("webpage_url") or data.get("original_url") or url,
        "extractor": data.get("extractor_key") or data.get("extractor"),
        "description": (data.get("description") or "")[:400] or None,
        "isLive": bool(data.get("is_live")),
        "isPlaylist": bool(playlist_count),
        "playlistCount": playlist_count,
        "heights": heights,
        "subtitleLangs": subtitle_langs,
        "hasAudio": not sources or any(f.get("acodec") not in (None, "none") for f in sources),
        "hasVideo": not sources or any(f.get("vcodec") not in (None, "none") for f in sources),
        "formats": [
            {
                "id": str(f.get("format_id") or ""),
                "ext": f.get("ext"),
                "height": f.get("height"),
                "width": f.get("width"),
                "vcodec": f.get("vcodec"),
                "acodec": f.get("acodec"),
                "filesize": f.get("filesize") or f.get("filesize_approx"),
            }
            for f in sources[:80]
            if isinstance(f, dict)
        ],
    }


def info(url: str) -> str:
    """Return the same summarized metadata object used by the desktop app."""
    if not url or not url.strip():
        return _json({"error": "missing_url"})
    try:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": 20,
            "retries": 1,
            "no_color": True,
        }
        with YoutubeDL(opts) as ydl:
            data = ydl.extract_info(url.strip(), download=False)
        if not data:
            return _json({"error": "no_metadata"})
        return _json(_summarize(data, url.strip()))
    except DownloadError as exc:
        return _json({"error": str(exc)})
    except Exception as exc:  # noqa: BLE001 - bridge must never throw into Java
        return _json({"error": str(exc), "trace": traceback.format_exc()})


def preview_url(url: str, mode: str = "video") -> str:
    """Resolve a direct media URL for the in-app <video>/<audio> player."""
    if not url or not url.strip():
        return _json({"error": "missing_url"})
    try:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": 20,
            "retries": 1,
        }
        with YoutubeDL(opts) as ydl:
            data = ydl.extract_info(url.strip(), download=False)

        formats = [f for f in (data.get("formats") or []) if isinstance(f, dict)]
        if mode == "audio":
            candidates = [f for f in formats if f.get("acodec") not in (None, "none")]
        else:
            candidates = [
                f for f in formats
                if f.get("vcodec") not in (None, "none")
                and str(f.get("url") or "").startswith(("http://", "https://"))
            ]
        chosen = candidates[-1] if candidates else None
        direct = (chosen or {}).get("url") or data.get("url")
        if not direct:
            return _json({"error": "no_preview_url"})
        return _json(
            {
                "url": direct,
                "ext": (chosen or {}).get("ext") or "mp4",
                "width": (chosen or {}).get("width"),
                "height": (chosen or {}).get("height"),
                "title": data.get("title"),
            }
        )
    except DownloadError as exc:
        return _json({"error": str(exc)})
    except Exception as exc:  # noqa: BLE001
        return _json({"error": str(exc), "trace": traceback.format_exc()})


def _format_selector(options: dict) -> str:
    if options.get("mode") == "audio":
        return "bestaudio/best"
    quality = str(options.get("quality") or "best").strip()
    if quality.isdigit():
        height = int(quality)
        return (
            f"best[height<={height}][acodec!=none][vcodec!=none]"
            f"/best[height<={height}]/best"
        )
    # Progressive single file: no FFmpeg needed inside the APK.
    return "best[acodec!=none][vcodec!=none]/best"


def _progress_hook(callback_id: str, cancel: threading.Event, pause: threading.Event):
    last_emit = 0.0

    def hook(progress: dict) -> None:
        nonlocal last_emit
        if cancel.is_set():
            raise DownloadError("cancelled")
        while pause.is_set() and not cancel.is_set():
            time.sleep(0.2)
        if cancel.is_set():
            raise DownloadError("cancelled")
        if progress.get("status") not in ("downloading", "finished"):
            return

        now = time.monotonic()
        if progress.get("status") == "downloading" and now - last_emit < 0.3:
            return
        last_emit = now

        total = progress.get("total_bytes") or progress.get("total_bytes_estimate") or 0
        done = progress.get("downloaded_bytes") or 0
        _emit(
            "progress",
            {
                "id": callback_id,
                "phase": "downloading",
                "percent": round((done / total) * 100, 2) if total else 0,
                "speed": progress.get("speed") or 0,
                "eta": progress.get("eta") or 0,
                "size": total,
            },
        )

    return hook


def download(options_json: str, output_dir: str) -> str:
    """Start a download thread. Returns immediately with the job id and folder."""
    try:
        options = json.loads(options_json or "{}")
    except (TypeError, ValueError):
        options = {}

    url = str(options.get("url") or "").strip()
    if not url:
        return _json({"error": "missing_url"})

    callback_id = str(options.get("id") or "").strip() or str(time.time_ns())
    target_dir = output_dir or _DEFAULT_DIR
    try:
        os.makedirs(target_dir, exist_ok=True)
    except OSError as exc:
        return _json({"error": str(exc)})

    cancel = threading.Event()
    pause = threading.Event()
    with _LOCK:
        _DOWNLOADS[callback_id] = {"cancel": cancel, "pause": pause}

    template = str(options.get("filenameTemplate") or "%(title).120s [%(id)s].%(ext)s")
    if "%(ext)s" not in template:
        template += ".%(ext)s"

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": not bool(options.get("playlist")),
        "socket_timeout": 20,
        "retries": 2,
        "restrictfilenames": True,
        "no_color": True,
        "format": _format_selector(options),
        "outtmpl": os.path.join(target_dir, template),
        "progress_hooks": [_progress_hook(callback_id, cancel, pause)],
    }

    def run() -> None:
        final_path = ""
        info_data = None
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info_data = ydl.extract_info(url, download=True)
                if info_data:
                    final_path = ydl.prepare_filename(info_data)
            _emit(
                "done",
                {
                    "id": callback_id,
                    "finalPath": final_path,
                    "folder": target_dir,
                    "title": (info_data or {}).get("title"),
                },
            )
        except DownloadError as exc:
            if not cancel.is_set():
                _emit("error", {"id": callback_id, "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            _emit(
                "error",
                {
                    "id": callback_id,
                    "message": str(exc),
                    "trace": traceback.format_exc(),
                },
            )
        finally:
            with _LOCK:
                _DOWNLOADS.pop(callback_id, None)

    thread = threading.Thread(target=run, name=f"wasel-dl-{callback_id}", daemon=True)
    thread.start()
    return _json({"ok": True, "id": callback_id, "folder": target_dir})


def cancel(callback_id: str) -> str:
    with _LOCK:
        state = _DOWNLOADS.get(callback_id)
    if not state:
        return _json({"ok": False, "error": "not_found"})
    state["cancel"].set()
    _emit("cancelled", {"id": callback_id})
    return _json({"ok": True, "id": callback_id})


def pause(callback_id: str) -> str:
    with _LOCK:
        state = _DOWNLOADS.get(callback_id)
    if not state:
        return _json({"ok": False, "error": "not_found"})
    state["pause"].set()
    return _json({"ok": True, "id": callback_id})


def resume(callback_id: str) -> str:
    with _LOCK:
        state = _DOWNLOADS.get(callback_id)
    if not state:
        return _json({"ok": False, "error": "not_found"})
    state["pause"].clear()
    return _json({"ok": True, "id": callback_id})


def _shutdown() -> None:
    with _LOCK:
        states = list(_DOWNLOADS.values())
    for state in states:
        state["cancel"].set()


atexit.register(_shutdown)

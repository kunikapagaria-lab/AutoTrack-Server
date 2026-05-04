import sys
import os
import threading
import time
import subprocess
import urllib.request

# When frozen by PyInstaller, executable directory is the install folder
if getattr(sys, 'frozen', False):
    INSTALL_DIR = os.path.dirname(sys.executable)
else:
    INSTALL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0


def is_docker_running() -> bool:
    try:
        r = subprocess.run(
            ['docker', 'info'],
            capture_output=True,
            timeout=8,
            creationflags=NO_WINDOW,
        )
        return r.returncode == 0
    except Exception:
        return False


def start_containers():
    try:
        subprocess.Popen(
            ['docker', 'compose', 'up', '-d'],
            cwd=INSTALL_DIR,
            creationflags=NO_WINDOW,
        )
    except Exception as e:
        print(f"Failed to start containers: {e}")


def wait_for_app(window):
    """Poll localhost until the app responds, then load it."""
    for _ in range(180):   # wait up to 3 minutes
        try:
            urllib.request.urlopen('http://localhost', timeout=2)
            window.load_url('http://localhost')
            return
        except Exception:
            time.sleep(1)
    # Timed out
    window.load_html(ERROR_HTML)


# ── HTML templates ─────────────────────────────────────────────────────────────

LOADING_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#0f1117;
    color:white;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    height:100vh; gap:20px;
  }
  h1 { font-size:2.5rem; font-weight:900; letter-spacing:0.35em; color:#d35400; }
  .sub { color:#6b7280; font-size:0.85rem; letter-spacing:0.05em; }
  .dots { display:flex; gap:8px; }
  .dot {
    width:10px; height:10px; border-radius:50%;
    background:#d35400; animation:pulse 1.4s infinite;
  }
  .dot:nth-child(2){ animation-delay:.25s; }
  .dot:nth-child(3){ animation-delay:.5s;  }
  @keyframes pulse{0%,100%{opacity:.15}50%{opacity:1}}
</style>
</head>
<body>
  <h1>AUTOTRACK</h1>
  <div class="dots">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
  <p class="sub">Starting up &mdash; this takes about 30 seconds&hellip;</p>
</body>
</html>"""

ERROR_HTML = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body{background:#0f1117;color:white;font-family:sans-serif;
       display:flex;flex-direction:column;align-items:center;
       justify-content:center;height:100vh;gap:16px;text-align:center;padding:40px;}
  h1{color:#d35400;font-size:1.5rem;}
  p{color:#6b7280;max-width:400px;line-height:1.6;}
  code{background:#1a1c22;padding:2px 8px;border-radius:4px;color:#f59e0b;}
</style>
</head>
<body>
  <h1>Could not connect to AutoTrack</h1>
  <p>The app took too long to start.<br>
     Please close this window, open <b>Docker Desktop</b>, wait for it to be ready,
     then try again.</p>
</body>
</html>"""


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    # Check Docker Desktop is running before doing anything
    if not is_docker_running():
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            "Docker Desktop is not running.\n\n"
            "Please:\n"
            "  1. Open Docker Desktop from the Start menu\n"
            "  2. Wait for the whale icon in the taskbar to stop animating\n"
            "  3. Open AutoTrack again\n\n"
            "If Docker Desktop is not installed, download it from:\n"
            "https://www.docker.com/products/docker-desktop",
            "AutoTrack — Docker Required",
            0x10,  # MB_ICONERROR
        )
        sys.exit(1)

    # Start containers silently in the background
    threading.Thread(target=start_containers, daemon=True).start()

    # Import webview here so the error dialog above can show without it
    import webview

    window = webview.create_window(
        title      = 'AutoTrack',
        html       = LOADING_HTML,
        width      = 1400,
        height     = 900,
        min_size   = (900, 600),
        text_select= False,
    )

    threading.Thread(target=wait_for_app, args=(window,), daemon=True).start()

    webview.start(debug=False)


if __name__ == '__main__':
    main()

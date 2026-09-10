"""Launch the built local app with the existing scientific Python environment."""
import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

BASE = Path(__file__).resolve().parent
URL = 'http://127.0.0.1:8765'
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def running():
    try:
        with HTTP.open(URL + '/api/health', timeout=1) as response:
            return json.load(response).get('app') == 'carruthers-local'
    except (OSError, ValueError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not (BASE / 'dist/client/index.html').is_file():
        raise SystemExit('The interface needs to be built first. In research-app, run: npm run build')
    if running():
        print(f'Carruthers is already running: {URL}')
        if not args.no_browser:
            webbrowser.open(URL)
        return
    try:
        with socket.create_connection(('127.0.0.1', 8765), timeout=.5):
            raise SystemExit('Port 8765 is in use by another application. Close it before starting Carruthers.')
    except OSError:
        pass
    log_dir = BASE / '.local'
    log_dir.mkdir(exist_ok=True)
    with (log_dir / 'app.log').open('a') as log:
        process = subprocess.Popen([sys.executable, str(BASE / 'server.py')], cwd=BASE, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise SystemExit(f'The app could not start. See {log_dir / "app.log"}')
                if running():
                    break
                time.sleep(.15)
            else:
                raise SystemExit(f'The app did not become ready. See {log_dir / "app.log"}')
            print(f'Untitled App: {URL}\nKeep this window open while using the app.\nPress Control+C here to stop it.', flush=True)
            if not args.no_browser:
                webbrowser.open(URL)
            process.wait()
        except KeyboardInterrupt:
            print('\nStopping Carruthers.')
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    main()

"""Fetch one immutable, narrowly scoped upstream snapshot. Never run upstream scripts."""
from pathlib import Path
import hashlib, io, json, urllib.request, zipfile

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {'User-Agent': 'Trace-canvas-lab'}
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as response:
        return response.read()

target = ROOT / 'vendor' / 'drawnix'
if target.exists():
    raise SystemExit('Snapshot exists; inspect it rather than silently replacing it.')
commit = json.loads(fetch('https://api.github.com/repos/plait-board/drawnix/commits/develop'))['sha']
archive = fetch(f'https://codeload.github.com/plait-board/drawnix/zip/{commit}')
kept = {}
with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
    for member in zipped.infolist():
        if member.is_dir():
            continue
        rel = '/'.join(member.filename.split('/')[1:])
        if rel not in ['LICENSE', 'tsconfig.base.json'] and not rel.startswith(tuple(f'packages/{name}/' for name in ['drawnix', 'react-board', 'react-text'])):
            continue
        dest = (target / rel).resolve()
        if not dest.is_relative_to(target.resolve()):
            raise ValueError('Unsafe archive path')
        payload = zipped.read(member)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(payload)
        kept[rel] = hashlib.sha256(payload).hexdigest()
record = {'repository': 'https://github.com/plait-board/drawnix', 'commit': commit,
          'archiveSha256': hashlib.sha256(archive).hexdigest(), 'license': 'MIT',
          'filesBeforeLocalPatch': kept, 'note': 'Three source packages only; no upstream build scripts executed.'}
(target / 'UPSTREAM.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
print(json.dumps({'commit': commit, 'files': len(kept), 'path': str(target)}, ensure_ascii=False))

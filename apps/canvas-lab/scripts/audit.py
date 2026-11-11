"""Pinned upstream/code/license evidence and a non-product-mutation audit."""
from pathlib import Path
import datetime, difflib, hashlib, json, shutil, time, urllib.request, urllib.error

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUT = REPO / '.test-results/canvas-lab'
HEADERS = {'User-Agent': 'Trace-canvas-lab-audit'}
def fetch(url):
    cache = OUT / 'network-cache' / hashlib.sha256(url.encode()).hexdigest()
    if cache.exists():
        return cache.read_bytes()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=45) as response:
                payload = response.read()
            cache.parent.mkdir(parents=True, exist_ok=True); cache.write_bytes(payload)
            return payload
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == 2:
                raise
            print(f'Network retry {attempt+1}/2: {url} ({type(error).__name__})', flush=True)
            time.sleep(2 * (attempt + 1))
def json_url(url):
    return json.loads(fetch(url))
def sha(payload):
    return hashlib.sha256(payload).hexdigest()
def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding='utf-8')

OUT.mkdir(parents=True, exist_ok=True)
licenses = ROOT / 'licenses'
licenses.mkdir(exist_ok=True)
upstream = json.loads((ROOT / 'vendor/drawnix/UPSTREAM.json').read_text(encoding='utf-8'))
changed = []
patch = []
for relative, expected in upstream['filesBeforeLocalPatch'].items():
    p = ROOT / 'vendor/drawnix' / relative
    if sha(p.read_bytes()) != expected:
        changed.append(relative)
        original = fetch(f"https://raw.githubusercontent.com/plait-board/drawnix/{upstream['commit']}/{relative}")
        if sha(original) != expected:
            raise ValueError('Upstream original hash differs: ' + relative)
        patch.extend(difflib.unified_diff(original.decode('utf-8').splitlines(True), p.read_text(encoding='utf-8').splitlines(True), fromfile='a/'+relative, tofile='b/'+relative))
expected_patches = {'packages/drawnix/src/drawnix.tsx', 'packages/drawnix/src/styles/index.scss'}
if set(changed) != expected_patches:
    raise ValueError('Unexpected upstream edits: ' + str(changed))
(ROOT / 'vendor/drawnix/TRACE-LAB.patch').write_text(''.join(patch), encoding='utf-8')
shutil.copyfile(ROOT / 'vendor/drawnix/LICENSE', licenses / 'drawnix-MIT.txt')

lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
manifest = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
dependencies = []
for package in manifest['dependencies']:
    directory = ROOT / 'node_modules' / package
    metadata = json.loads((directory / 'package.json').read_text(encoding='utf-8'))
    entry = lock['packages']['node_modules/'+package]
    license_files = [p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(('license', 'licence', 'copying'))]
    copies = []
    for p in license_files:
        target = licenses / (package.replace('@', '').replace('/', '-') + '-' + p.name)
        shutil.copyfile(p, target)
        copies.append({'file': str(target.relative_to(ROOT)), 'sha256': sha(p.read_bytes())})
    dependencies.append({'name': package, 'version': metadata['version'], 'license': metadata.get('license'), 'integrity': entry.get('integrity'), 'licenseFiles': copies})

# Some official npm artifacts omit the license file or SPDX field. Retain the
# actual upstream license, its commit, and that provenance gap rather than guess.
license_sources = {}
for dependency in dependencies:
    package = dependency['name']
    repo = ('plait-board/plait' if package.startswith('@plait/') else
            'ianstormtaylor/slate' if package.startswith('slate') else
            'alibaba/hooks' if package == 'ahooks' else
            'plait-board/' + package.split('/')[1] if package.startswith('@plait-board/') else None)
    if repo and (not dependency['licenseFiles'] or not dependency['license']):
        if repo not in license_sources:
            info = json_url('https://api.github.com/repos/'+repo)
            revision = json_url(f"https://api.github.com/repos/{repo}/commits/{info['default_branch']}")['sha']
            license_file = json_url('https://api.github.com/repos/'+repo+'/license')
            payload = fetch(f"https://raw.githubusercontent.com/{repo}/{revision}/{license_file['path']}")
            target = licenses / (repo.replace('/', '-') + '-LICENSE.txt')
            target.write_bytes(payload)
            license_sources[repo] = {'repository': repo, 'commit': revision, 'spdx': info['license']['spdx_id'], 'sourceFile': license_file['path'], 'localFile': str(target.relative_to(ROOT)), 'sha256': sha(payload)}
        provenance = license_sources[repo]
        dependency['licenseSource'] = provenance
        dependency['license'] = dependency['license'] or provenance['spdx']
        if not dependency['licenseFiles']:
            dependency['licenseFiles'] = [{'file': provenance['localFile'], 'sha256': provenance['sha256']}]

infinite_repo = 'basketikun/infinite-canvas'
commit = json_url(f'https://api.github.com/repos/{infinite_repo}/commits/main')['sha']
paths = ['LICENSE', 'web/package.json', 'web/src/components/canvas/infinite-canvas.tsx',
         'web/src/components/canvas/nodes/builtin-nodes.tsx', 'web/src/stores/canvas/use-canvas-store.ts',
         'web/src/types/canvas.ts', 'web/src/lib/canvas/plugin-runtime.ts', 'web/src/services/file-storage.ts',
         'web/src/pages/canvas/hooks/use-agent-bridge.ts', 'web/src/components/canvas/canvas-side-panel.tsx',
         'web/src/stores/use-canvas-side-panel-store.ts']
files = []
for relative in paths:
    url = f'https://raw.githubusercontent.com/{infinite_repo}/{commit}/{relative}'
    payload = fetch(url)
    p = OUT / 'upstream/infinite-canvas' / relative
    p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(payload)
    lines = payload.decode('utf-8').splitlines()
    keys = ['transform:', 'useCanvasStore', 'localForageStorage', 'persist(', 'CanvasNodeType.', 'fetch(', 'script', 'export type', 'viewport']
    excerpts = [{'line': i+1, 'text': line.strip()[:220]} for i, line in enumerate(lines) if any(key in line for key in keys)][:22]
    files.append({'path': relative, 'sourceUrl': f'https://github.com/{infinite_repo}/blob/{commit}/{relative}', 'sha256': sha(payload), 'lineCount': len(lines), 'excerpts': excerpts})
shutil.copyfile(OUT / 'upstream/infinite-canvas/LICENSE', licenses / 'infinite-canvas-MIT-reference-only.txt')
flow_meta = json_url('https://registry.npmjs.org/@xyflow%2freact/12.12.0')
flow_ref = json_url('https://api.github.com/repos/xyflow/xyflow/git/ref/tags/%40xyflow%2Freact%4012.12.0')['object']
while flow_ref['type'] == 'tag':
    flow_ref = json_url(flow_ref['url'])['object']
flow_commit = flow_ref['sha']
base = json.loads((OUT/'baseline.json').read_text(encoding='utf-8'))
violations = [p for p, expected in base['trackedFileHashes'].items() if not (REPO/p).exists() or sha((REPO/p).read_bytes()) != expected]
record = {'auditedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'drawnix': {'commit': upstream['commit'], 'sourceFiles': len(upstream['filesBeforeLocalPatch']), 'patchedFiles': changed, 'patchSha256': sha((ROOT/'vendor/drawnix/TRACE-LAB.patch').read_bytes()), 'license': 'MIT', 'publishedNpmPackageNotUsed': '0.4.0-0: older code and incomplete package metadata'},
          'reactflow': {'version': flow_meta['version'], 'sourceCommit': flow_commit, 'sourceTag': '@xyflow/react@12.12.0', 'archiveIntegrity': flow_meta['dist']['integrity'], 'license': flow_meta['license']},
          'directDependencies': dependencies, 'infiniteCanvas': {'commit': commit, 'runtimeExecuted': False, 'files': files},
          'productBaseline': {'head': base['repoHead'], 'filesChecked': len(base['trackedFileHashes']), 'changedOrMissing': violations},
          'tldraw': {'runtimeExecuted': False, 'licenseReference': 'https://tldraw.dev/sdk-features/license-key', 'note': 'Production requires a valid key; excluded from free-open-source runtime comparison.'}}
write_json(ROOT/'upstream-audit.json', record)
write_json(OUT/'audit.json', record)
print(json.dumps({'drawnixCommit': upstream['commit'], 'reactflowCommit': flow_commit, 'infiniteCommit': commit, 'pinnedDirectDependencies': len(dependencies), 'formalFilesChecked': len(base['trackedFileHashes']), 'changedFormalFiles': violations}, ensure_ascii=False))
if violations:
    raise SystemExit('Formal product files changed; inspect before delivery.')

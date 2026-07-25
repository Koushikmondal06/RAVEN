import json
from pathlib import Path
from graphify.detect import detect_incremental

r = detect_incremental(Path('/Users/fusion/Code/GitRepos/RAVEN'))
Path('graphify-out/.graphify_incremental.json').write_text(json.dumps(r, ensure_ascii=False), encoding='utf-8')
for cat, files in r.get('new_files', {}).items():
    for f in files:
        print(' ', cat, Path(f).name)
print('deleted:', len(r.get('deleted_files', [])), 'changed:', r.get('new_total', 0))

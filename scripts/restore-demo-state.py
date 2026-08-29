#!/usr/bin/env python3
"""恢复演示状态：把备份的 6 个演示视频回填到 v2 默认项目（files/ + manifest.json）"""
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/home/z/my-project')
SRC = ROOT / 'data-backup-before-step3'
FILES = ROOT / 'data' / 'projects' / 'default' / 'files'
MANIFEST = ROOT / 'data' / 'projects' / 'default' / 'manifest.json'

v1 = json.loads((SRC / 'manifest.json').read_text(encoding='utf-8'))
FILES.mkdir(parents=True, exist_ok=True)

now = datetime.now(timezone.utc).isoformat()
items = []
for slot in v1['slots']:
    video = slot.get('video')
    if not video:
        continue
    shutil.copy2(SRC / 'uploads' / video['filename'], FILES / video['filename'])
    items.append({
        'id': f'demo-{len(items)+1:02d}',
        'kind': 'video',
        'title': slot.get('title', ''),
        'order': len(items),
        'aspectRatio': None,
        'createdAt': now,
        'updatedAt': now,
        'file': video,
    })

project = {
    'id': 'default',
    'name': '默认项目',
    'status': 'active',
    'items': items,
    'layout': v1['layout'],
    'slotCount': v1['count'],
    'settings': {
        'aspectRatio': 'original',
        'showTitles': True,
        'loop': False,
        'muted': True,
        'playbackRate': 1,
    },
    'createdAt': now,
    'updatedAt': now,
}
MANIFEST.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"已恢复 {len(items)} 个演示视频，layout={project['layout']}")

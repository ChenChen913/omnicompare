#!/usr/bin/env python3
"""恢复演示状态（自包含版，API 驱动）：
清空默认项目 → 2×3 布局 → 上传 6 个测试视频 → 标题「示例视频 1~6」→ 演示设置（循环开/静音开）。
不依赖任何本地备份；仅需 dev 服务运行于 :3000 与 scripts/test-videos/ 测试资产（gen-test-videos.sh 可再生）。
"""
import json
import subprocess
import sys
from pathlib import Path

BASE = 'http://localhost:3000'
VIDEOS = [
    'v01-landscape.mp4', 'v02-portrait.mp4', 'v03-square.mp4',
    'v04-ultrawide.mp4', 'v05-tiny.mp4', 'v06-landscape.mp4',
]
VIDEO_DIR = Path('/home/z/my-project/scripts/test-videos')


def curl_json(method: str, url: str, form=None, data=None) -> dict:
    cmd = ['curl', '-s', '-X', method]
    if form:
        cmd += form
    if data is not None:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(data)]
    out = subprocess.run(cmd + [url], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def main() -> int:
    if not all((VIDEO_DIR / v).exists() for v in VIDEOS):
        print('缺少测试视频资产，请先执行：bash scripts/gen-test-videos.sh')
        return 1

    # 1. 布局 2×3 并清空（幂等起点）
    curl_json('PATCH', f'{BASE}/api/videos/layout', data={'count': 6, 'rows': 2, 'cols': 3})
    curl_json('DELETE', f'{BASE}/api/videos?all=1')

    # 2. 依次上传 6 个视频并命名
    for i, name in enumerate(VIDEOS):
        r = curl_json('POST', f'{BASE}/api/videos/upload',
                      form=['-F', f'file=@{VIDEO_DIR / name}', '-F', f'slot={i}'])
        if not r.get('slots', [{}])[i].get('video'):
            print(f'上传失败：slot {i} <- {name}')
            return 1
        curl_json('PATCH', f'{BASE}/api/videos',
                  data={'slot': i, 'title': f'示例视频 {i + 1}'})

    # 3. 演示设置：循环开、静音开（自动播放策略）
    curl_json('PATCH', f'{BASE}/api/videos/settings',
              data={'aspectRatio': 'original', 'loop': True, 'muted': True,
                    'showTitles': True, 'showInfo': True, 'playbackRate': 1})

    final = curl_json('GET', f'{BASE}/api/videos')
    filled = sum(1 for s in final['slots'] if s.get('video'))
    print(f"完成：默认项目 {filled}/6 视频，layout={final['layout']}，标题=示例视频 1~6，loop=true muted=true")
    return 0 if filled == 6 else 1


if __name__ == '__main__':
    sys.exit(main())

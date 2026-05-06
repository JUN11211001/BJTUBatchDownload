"""
运行此脚本生成插件图标：python make_icons.py
需要 Pillow：pip install Pillow
"""
from PIL import Image, ImageDraw, ImageFont
import os

def make_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角矩形背景
    r = size // 6
    d.rounded_rectangle([0, 0, size-1, size-1], radius=r, fill=(74, 127, 212, 255))
    # 简单下载箭头
    cx, cy = size // 2, size // 2
    aw = size * 0.45
    ah = size * 0.35
    # 竖线
    d.rectangle([cx - size*0.07, cy - ah//2, cx + size*0.07, cy + ah*0.1], fill='white')
    # 箭头头部
    pts = [
        (cx, cy + ah * 0.5),
        (cx - aw//2, cy + ah * 0.1),
        (cx + aw//2, cy + ah * 0.1),
    ]
    d.polygon(pts, fill='white')
    # 底部横线
    lh = size * 0.08
    ly = cy + ah * 0.65
    d.rectangle([cx - aw//2, ly, cx + aw//2, ly + lh], fill='white')
    return img

for size in [16, 48, 128]:
    icon = make_icon(size)
    icon.save(f'icon{size}.png')
    print(f'icon{size}.png generated')

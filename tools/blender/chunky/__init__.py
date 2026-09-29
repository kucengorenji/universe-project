"""Chunky-toon asset kit (Overcooked-like look) for Blender 5.x.

    kit.py      bmesh modelling primitives, palette-driven materials, glTF export
    studio.py   lights, cameras, backdrops and still renders
    palette.py  colour tokens (room props and NPC wardrobe)
    npc.py      modular NPC kit: skeleton, heads, hair, garments, presets, clips
    props.py    kitchen / room props

Import with tools/blender on sys.path. `reload_all()` re-imports every module in
dependency order, for iterating inside a live Blender session.
"""
import importlib
import sys

_ORDER = ('palette', 'kit', 'studio', 'npc', 'props')


def reload_all():
    for name in _ORDER:
        mod = sys.modules.get(f'{__name__}.{name}')
        if mod is not None:
            importlib.reload(mod)

"""Original, deterministic texture sources. Pillow; no downloaded artwork.
The surface atlas is neutral so one texture can tint every architecture style.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import random, math

# public/ holds only what the game loads at runtime; the foliage cards are
# embedded into scenery.glb by build_scenery.py, so they stay with the sources.
OUT = Path(__file__).resolve().parents[2] / 'public' / 'textures'
SOURCES = Path(__file__).resolve().parent / 'textures'
OUT.mkdir(exist_ok=True)
SOURCES.mkdir(exist_ok=True)
S = 128
rng = random.Random(8217)
atlas = Image.new('RGB', (S * 4, S * 4), 'white')
# plain, plaster, brick, timber, stone, roof tile, slate, metal,
# bark, cobble, paving, earth, grass, sand, cloth, concrete.
for tile in range(16):
    im = Image.new('RGB', (S, S), (239, 239, 239))
    p = im.load()
    for y in range(S):
        for x in range(S):
            v = 248 if tile == 0 else int(229 + rng.random()*19 + math.sin(x*.18)*math.sin(y*.13)*4)
            p[x,y] = (v,v,v)
    d = ImageDraw.Draw(im)
    if tile in (2,4,5,6,9,10):
        h = {2:16,4:32,5:24,6:20,9:20,10:32}[tile]
        w = {2:40,4:48,5:24,6:32,9:25,10:32}[tile]
        for row,y in enumerate(range(-h,S+h,h)):
            for x in range(-w,S+w,w):
                off = 0 if tile==10 else (row%2)*w//2
                grey = rng.randint(216,248)
                d.rounded_rectangle((x+off+1,y+1,x+off+w-1,y+h-1),radius=3 if tile in (4,9) else 1,fill=(grey,)*3,outline=(173,)*3,width=1)
                d.line((x+off+2,y+2,x+off+w-2,y+2),fill=(254,)*3)
    if tile in (3,8):
        for x in range(0,S,4):
            pts=[(x+2*math.sin(y*.045+x),y) for y in range(S)]
            d.line(pts,fill=(195+rng.randrange(30),)*3,width=1)
        for x in range(0,S,32): d.line((x,0,x,S),fill=(155,)*3,width=2)
    if tile==7:
        for x in range(0,S,32): d.line((x,0,x,S),fill=(194,)*3,width=2)
    if tile in (11,12,13):
        for _ in range(500):
            x,y=rng.randrange(S),rng.randrange(S); grey=rng.randint(155,245)
            d.line((x,y,x+(1 if tile==12 else 2),y+(4 if tile==12 else 1)),fill=(grey,)*3)
    if tile==14:
        for x in range(0,S,3): d.line((x,0,x,S),fill=(213,)*3)
        for y in range(0,S,3): d.line((0,y,S,y),fill=(220,)*3)
    # Repeat-safe opposite edges; gutters sampled by the material shader.
    for y in range(S): im.putpixel((S-1,y),im.getpixel((0,y)))
    for x in range(S): im.putpixel((x,S-1),im.getpixel((x,0)))
    atlas.paste(im,((tile%4)*S,(tile//4)*S))
# All three channels are identical: lossless grayscale PNG cuts transfer size.
atlas.convert('L').save(OUT/'town_surfaces.png',optimize=True)

cards=Image.new('RGBA',(S*4,S*4),(92,152,53,0))
for tile in range(16):
    im=Image.new('RGBA',(S,S),(92,152,53,0));d=ImageDraw.Draw(im)
    d.line((S/2,S-9,S/2,18),fill=(100,111,53,255),width=2)
    for i in range(68 if tile<12 else 16):
        a=rng.random()*math.tau;r=math.sqrt(rng.random())*43
        x=S/2+math.cos(a)*r;y=61+math.sin(a)*r
        d.line((S/2,86,x,y),fill=(106,120,55,255),width=1)
        green=rng.randrange(126,191)
        c=(green*.63,green,green*.38,255)
        if tile>=12: c=[(239,199,71,255),(230,137,161,255),(173,163,232,255),(240,238,211,255)][tile-12]
        c=tuple(int(v) for v in c)
        rx,ry=(3,12) if tile%4==2 else (7,10) if tile%4==1 else (9,6)
        if tile>=12:
            for petal in range(5):
                a=petal*math.tau/5;px=x+math.cos(a)*4;py=y+math.sin(a)*4
                d.ellipse((px-3,py-3,px+3,py+3),fill=c)
            d.ellipse((x-2,y-2,x+2,y+2),fill=(225,179,54,255))
        else:
            angle=a*.55+tile*.31;ca,sa=math.cos(angle),math.sin(angle)
            outline=[(-rx,0),(-rx*.4,-ry*.7),(rx*.3,-ry),(rx,0),(rx*.35,ry*.8),(-rx*.5,ry*.65)]
            polygon=[(x+u*ca-v*sa,y+u*sa+v*ca) for u,v in outline]
            d.polygon(polygon,fill=c)
            d.line((x-rx*.8*ca,y-rx*.8*sa,x+rx*.8*ca,y+rx*.8*sa),fill=(min(255,c[0]+23),min(255,c[1]+18),c[2],255))
    if tile in (9,10):
        # Needle spray and pinnate palm frond each have their own silhouette.
        im=Image.new('RGBA',(S,S),(86,146,48,0));d=ImageDraw.Draw(im)
        d.line((64,120,64,7),fill=(124,152,59,255),width=2)
        count=26 if tile==10 else 36
        for j in range(count):
            t=(j+1)/(count+2);y=118-t*108
            span=(math.sin(t*math.pi)**.7)*(47 if tile==10 else 37)
            for side in [-1,1]:
                x=64+side*span
                colour=(rng.randrange(77,117),rng.randrange(139,185),rng.randrange(39,68),255)
                d.polygon([(64,y+3),(x,y-9),(x-side*5,y-6),(64,y-1)],fill=colour)
        cards.paste(im,((tile%4)*S,(tile//4)*S))
    else:
        cards.paste(im,((tile%4)*S,(tile//4)*S))
cards.save(SOURCES/'flora_cards.png',optimize=True)
print('Original surface and foliage atlases written')

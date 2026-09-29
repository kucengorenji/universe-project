"""Colour tokens (sRGB hex). Materials are named M_<token> and built from these.

Room palette: sampled by eye from the kitchen diorama and prop-pack references
(teal walls, terracotta tile, blue cabinets under orange wood, red appliances,
green status LEDs). NPC palette: the wardrobe colours from
docs/art-direction/npc-v1/catalog.json plus skin and hair tones.
"""

ROOM = {
    # walls, trim, floor
    'wall_teal': 0x2EA98A, 'wall_teal_dark': 0x1F8B74, 'wall_teal_light': 0x4CC2A1,
    'trim_cream': 0xF6E3BC, 'trim_orange': 0xF2B766, 'trim_orange_dark': 0xD9923F,
    'tile_a': 0xE0865B, 'tile_b': 0xEEA271, 'tile_c': 0xF6DDB8, 'tile_d': 0xCC6F4B, 'grout': 0x9C4E3A,
    # cabinets and counters
    'cab_blue': 0x2F6690, 'cab_blue_dark': 0x244F73, 'cab_blue_light': 0x4283B4, 'cab_teal': 0x2A9AA0,
    'top_wood': 0xF3A84B, 'top_wood_light': 0xFAC46E, 'top_wood_edge': 0xC97F2E,
    # woods
    'wood_pale': 0xF2C57C, 'wood_mid': 0xDB9A55, 'wood_dark': 0x8A5533, 'wood_deep': 0x5E3823,
    # appliance bodies
    'slate': 0x363B55, 'slate_light': 0x4A5072, 'slate_dark': 0x252A3F, 'plum': 0x4B3B4F, 'plum_light': 0x66526B,
    'steel': 0xB4B8C6, 'steel_light': 0xD9DCE6, 'steel_dark': 0x7C8194, 'iron': 0x2A2C36,
    'cream': 0xF3ECE0, 'cream_dark': 0xD9CFBC, 'white': 0xF6F4EF,
    'red': 0xD8352F, 'red_dark': 0xA82722, 'red_light': 0xF0584D,
    'orange': 0xF28C28, 'orange_light': 0xF8B45A, 'yellow': 0xF6D65B, 'yellow_dark': 0xD9AE2E,
    'purple': 0x6B3A8C, 'purple_light': 0x9060B8, 'pink': 0xF28496, 'pink_light': 0xF8C4CB,
    'blue': 0x2C7AC4, 'blue_light': 0x6FB1EA, 'blue_dark': 0x1D5286,
    'green': 0x58C768, 'green_dark': 0x2F8F45, 'led_green': 0x5CFF6E,
    'glass': 0x9FD3E6, 'glass_dark': 0x1E2233, 'screen_blue': 0x3E6EE0, 'screen_dark': 0x1B2440,
    'brick': 0xD9784A, 'brick_dark': 0xA95A3B, 'brick_light': 0xE9975F, 'clay': 0xA95A3B,
    'ember': 0xFF7A2E, 'fire': 0xFFB347, 'bubble': 0xF8DDF3,
    'paper': 0xF4E3C0, 'paper_dark': 0xD9C296, 'gingham_a': 0xE8788A, 'gingham_b': 0xFBEFEA,
    # food
    'steak': 0xF28496, 'fat': 0xF9E8E2, 'sausage': 0xB7352B, 'sausage_dark': 0x8F2820, 'egg': 0xF1E2C2, 'egg_shell': 0xE7C9A0,
    'bread': 0xE7B067, 'bread_dark': 0xC48440, 'patty': 0x6A3A2D, 'chicken': 0xE59A3F, 'chicken_dark': 0xC1732A,
    'lettuce': 0x86D064, 'tomato': 0xE2432F, 'cheese': 0xF7C948, 'donut': 0xF19AC2, 'apple': 0xD8352F, 'lemon': 0xF7DB4A,
    'coffee': 0x6B4030, 'milk': 0xFAFAF5, 'oil': 0xF5A22C,
    # misc
    'rubber': 0x2A2A2E, 'black': 0x1C1C22, 'grey': 0x8E92A3, 'grey_light': 0xC5C8D3,
    'cushion_blue': 0x2C7AC4, 'cushion_yellow': 0xF6D65B, 'blanket': 0x2C7AC4, 'radiator': 0xEFE7D4,
    'lampshade': 0xF29A4B, 'pc_beige': 0xE6D8B8, 'pc_beige_dark': 0xC9B98F,
    'banner_purple': 0x7A4AA0, 'banner_teal': 0x2C8D8B, 'banner_red': 0xD9584B, 'banner_mustard': 0xF0B93B,
    'lamp_glow': 0xFFE3A3, 'plant': 0x58C768, 'plant_dark': 0x2F8F45, 'pot_terracotta': 0xD9784A,
    'floor_grey': 0x8B8C93, 'stage_grey': 0x6F7079,
}

# Emissive tokens: name -> strength (LEDs, flames, lit lamps)
EMISSIVE = {'led_green': 3.0, 'ember': 3.5, 'fire': 3.0, 'lamp_glow': 2.0, 'screen_blue': 1.4}

# Per-token roughness overrides (default 0.55)
ROUGHNESS = {
    'steel': 0.32, 'steel_light': 0.28, 'steel_dark': 0.4, 'glass': 0.12, 'glass_dark': 0.15,
    'red': 0.42, 'red_light': 0.42, 'cream': 0.5, 'white': 0.45, 'slate': 0.45, 'plum': 0.5,
    'top_wood': 0.5, 'top_wood_light': 0.5, 'wood_pale': 0.62, 'wood_mid': 0.62, 'wood_dark': 0.65,
    'tile_a': 0.7, 'tile_b': 0.7, 'tile_c': 0.7, 'tile_d': 0.7, 'grout': 0.9,
    'gingham_a': 0.85, 'gingham_b': 0.85, 'paper': 0.9, 'blanket': 0.9, 'bubble': 0.2, 'coffee': 0.3, 'oil': 0.2,
}

# Tokens that render see-through: name -> alpha
ALPHA = {'glass': 0.45, 'bubble': 0.9}

# NPC wardrobe (catalog.json themes) -----------------------------------------
NPC = {
    # skin tones, light -> deep
    'skin_light_warm': 0xF2C4A0, 'skin_light_olive': 0xE3B98F, 'skin_medium_warm': 0xDFA579, 'skin_medium_tan': 0xCB8B62,
    'skin_tan': 0xBD7D55, 'skin_brown': 0x9A5F3E, 'skin_deep_warm': 0x7B4A30, 'skin_deep_brown': 0x5E3524,
    # hair
    'hair_black': 0x26211F, 'hair_dark_brown': 0x3B281E,
    # cafe / campus / office / workshop / outdoor colours
    'stripe_blue': 0x86A9BD, 'stripe_light': 0xE4EDF2, 'cream': 0xECE5D6, 'charcoal': 0x353735, 'terracotta': 0xAF6249,
    'sage': 0x929D86, 'coral': 0xC98273, 'navy': 0x30394B, 'navy_dark': 0x2A3140, 'dusty_blue': 0x8199AF, 'brown': 0x705039,
    'olive': 0x74785E, 'ochre': 0xBC9852, 'tan_boot': 0x9F7955, 'rust': 0xA8553C, 'teal': 0x51827E, 'sand': 0xC6B491,
    'canvas_black': 0x26272A, 'sole_cream': 0xE8E0CC, 'loafer_black': 0x1F1F22, 'hiking_dark': 0x46443F, 'hiking_gray': 0x7A7D80,
    'lace_orange': 0xD9803A, 'lens_clear': 0xDCEBF2, 'frame_black': 0x1E1E20, 'frame_wire': 0x3B3B3F, 'cap_black': 0x232326,
    'tee_black': 0x2A2B2E, 'eye_white': 0xF4F1EA, 'pupil': 0x231D1B, 'mouth': 0x6B2E2B, 'lip': 0xB5675A, 'teeth': 0xF4F1EA,
}

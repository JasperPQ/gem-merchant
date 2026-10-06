"""每张土地牌、每位贵族的画面描述。

一级：取得宝石原石（采矿、淘洗、筛选、运矿……）；二级：加工（切割、打磨、镶嵌、雕刻……）；
三级：带魔法感的成品。分数越高的牌，场面越宏大。
描述里只写主体和场景；主题宝石、辅色和画风由 build_card_prompt 统一拼上。
"""
from __future__ import annotations

GEMS = {
    "white": "white diamond",
    "blue": "blue sapphire",
    "green": "green emerald",
    "red": "red ruby",
    "black": "black obsidian gemstone",
}

CARD_SCENES: dict[str, str] = {
    # ---------- 一级：原石 ----------
    # 白 · 钻石
    "L1-17": "a prospector kneeling on a riverbank panning gravel, a raw {gem} glinting in the pan",
    "L1-18": "two miners pushing a mine cart loaded with raw {gem} ore along rails in a tunnel",
    "L1-19": "a young miner in a fur hat chipping a raw {gem} crystal out of a frozen ice cave wall with a pickaxe, ice shards flying",
    "L1-20": "a geologist with a magnifying glass examining a raw {gem} embedded in a boulder at a quarry",
    "L1-21": "a worker sifting dirt through a wooden sieve, revealing small raw {gem} stones",
    "L1-22": "an old miner lowering a lantern into a deep shaft lined with sparkling raw {gem} veins",
    "L1-23": "a girl finding a raw {gem} in a dry riverbed at dusk",
    "L1-24": "miners splitting open a huge raw {gem} geode in a vast cavern",
    # 蓝 · 蓝宝石
    "L1-09": "a miner wading through an underground stream, picking a raw {gem} out of the water",
    "L1-10": "a miner leading a mule that carries sacks of raw {gem} ore down a mountain path",
    "L1-11": "a miner swinging a pickaxe at a wall streaked with raw {gem} crystals, rock chips flying",
    "L1-12": "a woman washing raw {gem} gravel in a wooden sluice box beside a stream",
    "L1-13": "a prospector hammering a claim stake next to a raw {gem} outcrop on a cliff edge",
    "L1-14": "miners hauling a basket of raw {gem} stones up a shaft with a rope pulley",
    "L1-15": "a young apprentice discovering a raw {gem} under a tree root in a forest",
    "L1-16": "miners with lanterns exploring a vast cave full of raw {gem} crystals",
    # 绿 · 祖母绿
    "L1-25": "a miner drilling into a jungle cliff where raw {gem} crystals poke out of the rock",
    "L1-26": "workers digging in a terraced hillside pit, one holding up a raw {gem}",
    "L1-27": "a miner cracking open a rock with a chisel, revealing a raw {gem} inside",
    "L1-28": "a prospector panning in a jungle river, raw {gem} stones glinting in the water",
    "L1-29": "two miners carrying a stretcher with a large raw {gem} out of a tunnel",
    "L1-30": "a miner sorting rough raw {gem} stones on a wooden table under a canvas tent",
    "L1-31": "a lone miner climbing a ladder in a narrow shaft beside a glowing raw {gem} vein",
    "L1-32": "an ancient mine entrance carved into a mountainside, glowing raw {gem} veins in the rock",
    # 红 · 红宝石
    "L1-33": "a miner with a lantern discovering a raw {gem} vein in a narrow crevice",
    "L1-34": "workers shoveling raw {gem} gravel into a mine cart in a torchlit tunnel",
    "L1-35": "a prospector in a desert canyon chiseling a raw {gem} from the rock face",
    "L1-36": "a miner with a pickaxe chipping a large glowing raw {gem} vein out of a mine wall, lantern light",
    "L1-37": "an old woman washing raw {gem} gravel in a wooden basin by a river",
    "L1-38": "a miner lighting a short fuse near a raw {gem} seam while others take cover behind crates",
    "L1-39": "a miner resting on a crate, holding up a raw {gem} to the lamplight",
    "L1-40": "a volcanic cavern with huge raw {gem} crystals and lava glow, miners in silhouette",
    # 黑 · 黑玛瑙
    "L1-01": "a miner digging raw {gem} stones in a dark quarry at night by torchlight",
    "L1-02": "miners loading raw {gem} blocks onto a wooden sled",
    "L1-03": "a miner breaking a raw {gem} boulder with a sledgehammer",
    "L1-04": "a prospector studying a map by a campfire next to a pile of raw {gem}",
    "L1-05": "a young miner crawling through a tight tunnel toward a glinting raw {gem} vein",
    "L1-06": "workers sorting raw {gem} at a riverside sorting station",
    "L1-07": "a miner chiseling raw {gem} from jagged cliffs near a volcano",
    "L1-08": "a colossal raw {gem} crystal in an underground lake, miners on a raft with lanterns",
    # ---------- 二级：加工 ----------
    # 白
    "L2-13": "a gem cutter cleaving a {gem} with a chisel and mallet at a workbench",
    "L2-14": "a jeweler examining a cut {gem} through a loupe at a cluttered desk",
    "L2-15": "an apprentice polishing a {gem} on a spinning lap wheel driven by a foot pedal",
    "L2-16": "a craftsman setting a {gem} into a ring with tiny tweezers under a lamp",
    "L2-17": "a master cutter grinding the first facets onto a rough, half-cut {gem} held in a clamp against a spinning stone wheel, stone dust flying, files and chisels scattered on the workbench",
    "L2-18": "a busy cutting workshop where three artisans saw, chisel and grind a huge rough {gem} that is still half raw rock, sparks and stone dust in the air",
    # 蓝
    "L2-07": "a gem cutter sawing a rough {gem} in half with a bow saw on a workbench, one half still raw rock, the fresh cut face shining, dust flying",
    "L2-08": "a jeweler engraving a pattern onto a polished {gem}",
    "L2-09": "a gem cutter pressing a half-polished {gem} against a spinning grinding wheel, water spraying from the wheel, white marble workbench, a green potted plant",
    "L2-10": "an appraiser measuring a rough uncut {gem} with brass calipers before cutting, facet sketches pinned on the wall, chalk marks on the stone",
    "L2-11": "an artisan chiseling a rough {gem} by candlelight, chips flying, carving tools spread on the table, green leaves at the window",
    "L2-12": "a large guild workshop where several cutters at spinning wheels work on a big rough {gem} being split on the central table, red-hot forge glow, sparks",
    # 绿
    "L2-19": "a craftsman grinding a {gem} on a water-cooled wheel, water splashing",
    "L2-20": "a jeweler filing the rough edges of a {gem} clamped in a vise, metal filings and stone dust on the bench",
    "L2-21": "two apprentices sorting cut {gem} stones by size into wooden trays",
    "L2-22": "a gem cutter marking cutting lines on a rough {gem} with ink",
    "L2-23": "an engraver carving tiny leaf patterns into a rough {gem} under a magnifying lens, cool blue evening light from the window fills the whole workshop",
    "L2-24": "an artisan polishing a large {gem} orb on a lathe in a greenhouse workshop",
    # 红
    "L2-25": "a gem cutter splitting a rough {gem} with a hammer and wedge",
    "L2-26": "a jeweler drilling a hole through a {gem} bead with a bow drill",
    "L2-27": "an apprentice heating a {gem} in a small furnace with long tongs",
    "L2-28": "a craftsman faceting a {gem} on a lap wheel, light reflecting from its facets",
    "L2-29": "a jeweler at a soot-covered workbench chipping a rough {gem} out of its host rock with a small hammer and pick, sparks flying",
    "L2-30": "a big workshop where artisans grind a giant rough {gem} on a huge water-powered wheel, water and dust spraying",
    # 黑
    "L2-01": "a stone carver in a leather apron standing in front of a rough {gem} block, hammering a chisel into it, chips flying, a half-carved shape emerging",
    "L2-02": "an artisan slicing a {gem} into thin plates with a wire saw",
    "L2-03": "a jeweler cracking a rough {gem} geode open with a hammer and chisel on an anvil, sparks flying",
    "L2-04": "inside a stonecutter's workshop with tools hanging on the wall, a craftsman feeds a big rough {gem} block into a large circular saw on a heavy workbench, half of the block already sliced with a smooth cut face, stone dust in the air",
    "L2-05": "an engraver carving a seal from {gem} at a candlelit desk",
    "L2-06": "a master artisan grinding a large rough {gem} slab on a big spinning stone wheel, sparks flying",
    # ---------- 三级：魔法成品 ----------
    # 白
    "L3-09": "a radiant {gem} tiara floating in moonlight, surrounded by magical sparkles",
    "L3-10": "an enchanted {gem} pendant hovering above an open spellbook, glowing runes rising",
    "L3-11": "a crown of {gem} stones on a velvet pillow, emitting beams of magical light",
    "L3-12": "a legendary heart-sized {gem} suspended in a starry sky shrine with a magical aura",
    # 蓝
    "L3-05": "a wizard staff tipped with a {gem}, crackling with magical energy",
    "L3-06": "an enchanted {gem} ring floating above a still pool, rings of light rippling outward",
    "L3-07": "a {gem} orb inside a celestial armillary sphere, glowing constellations around it",
    "L3-08": "a royal scepter crowned with a {gem}, crackling with magical lightning in a throne room",
    # 绿
    "L3-13": "a {gem} amulet with a living vine growing around it, magical glow",
    "L3-14": "a {gem} crown floating above an ancient forest altar, glowing leaves swirling",
    "L3-15": "a {gem} chalice overflowing with glowing magical light",
    "L3-16": "a magnificent {gem} jewel floating above a carved stone pedestal, glowing runes in the air",
    # 红
    "L3-17": "a phoenix-shaped brooch set with {gem} stones, magical flames swirling around it",
    "L3-18": "a {gem} set in the pommel of a legendary sword, glowing with fire magic",
    "L3-19": "a heart-shaped {gem} pendant pulsing with magical light on an ornate pedestal",
    "L3-20": "a dragon egg made of {gem} glowing in a nest of treasure, magical heat shimmering",
    # 黑
    "L3-01": "a {gem} royal crown floating in a dark vault, small white, blue, green and red gems set around its band, magical golden light radiating from behind it",
    "L3-02": "a {gem} ring that bends light around it, swirls of magical void",
    "L3-03": "a {gem} raven statue with glowing gem eyes and a magical aura",
    "L3-04": "a {gem} throne inlaid with magical gems, mystic glow all around",
}

# 贵族：各个年龄、来自世界各地；服饰颜色 = 拜访条件里的颜色。
NOBLE_SCENES: dict[str, str] = {
    "N-01": "a young East Asian nobleman in his twenties, wearing flowing white robes with blue and green embroidery and a green jade hairpin",
    "N-02": "a middle-aged West African queen with a tall patterned headwrap in blue, green and red, beaded necklace",
    "N-03": "a young Mexican noblewoman with long braided black hair, wearing a green and red embroidered dress with a black lace shawl",
    "N-04": "an elderly Japanese nobleman with white hair and beard, wearing a black haori over a red kimono with white crests",
    "N-05": "a middle-aged Scandinavian noblewoman with braided blonde hair, wearing a black velvet gown with a white fur collar and a blue brooch",
    "N-06": "a teenage Persian prince wearing a white silk robe with blue patterns and a white turban",
    "N-07": "a middle-aged Pacific Islander noblewoman with a crown of green leaves, wearing a deep blue wrap dress and a necklace of blue shells",
    "N-08": "an elderly Indian noblewoman with silver hair, dignified and kind, wearing an elegant green silk sari with a red embroidered border and red jewels",
    "N-09": "a young East African nobleman with short curly hair, wearing a red cape with black embroidered patterns",
    "N-10": "an elderly European duchess with silver hair, wearing a black gown with a white lace collar and a pearl necklace",
}

ACCENT_WORDS = {"white": "white", "blue": "blue", "green": "green", "red": "red", "black": "black"}
STYLE_A = ", dark moody lighting, the focal gem glows brightly against dark surroundings, pixel art"


def accent_phrase(bonus: str, cost: dict[str, int]) -> str:
    """把兑换条件转成辅色描述：数量越多，在画面里占得越多。"""
    parts = []
    for color, amount in sorted(cost.items(), key=lambda item: -item[1]):
        if amount <= 0 or color == bonus:
            continue
        qualifier = "lots of" if amount >= 4 else "some" if amount >= 2 else "a touch of"
        parts.append(f"{qualifier} {ACCENT_WORDS[color]}")
    return ", ".join(parts)


# 二级是"正在加工"：不要发光、不要成品首饰，要原石、工具、粉尘。
STYLE_WORKSHOP = (", dark moody workshop lighting, gritty and dusty, work in progress, rough unfinished gemstone, "
                  "tools in use, no finished jewelry, no magic glow, pixel art")


def focal_sentence(bonus: str, level: int = 1) -> str:
    if bonus == "black":
        # 黑宝石做发光焦点会被画成浅色水晶；改成暖光前的黑色剪影。
        if level == 2:
            # 二级在室内工坊：衬在暖色灯光的墙面前，避免画成一级那种发光的矿洞口。
            return ("The pitch-black glossy rough half-cut obsidian block is the focal point in the center, clamped on the "
                    "workbench, its dark silhouette standing out against the warm lamplit workshop wall behind it, sharp white glints on its edges")
        return ("The pitch-black glossy obsidian gemstone is the focal point in the center, its dark silhouette "
                "standing out against a bright warm glow behind it, sharp white glints on its edges")
    if level == 2:
        return f"The rough, half-cut {GEMS[bonus]} being worked on is the focal point in the center, lit by the workshop lamp"
    return f"The {GEMS[bonus]} is the bright glowing focal point in the center"


def build_card_prompt(card: dict) -> str:
    gem = GEMS[card["bonusColor"]]
    scene = CARD_SCENES[card["id"]].format(gem=gem)
    accents = accent_phrase(card["bonusColor"], card["cost"])
    text = f"board game card illustration: {scene}. {focal_sentence(card['bonusColor'], card['level'])}"
    if accents:
        text += f". Secondary colors in the surroundings: {accents}"
    return text + (STYLE_WORKSHOP if card["level"] == 2 else STYLE_A)


def build_noble_prompt(noble_id: str) -> str:
    return "bust portrait of " + NOBLE_SCENES[noble_id] + ", dignified expression, centered, plain dark background" + STYLE_A

# ---------- 动态版：每张牌的动作描述（只写怎么动，不写长什么样） ----------
# 首帧和末帧都是静态图，所以动作要能回到原位，形成无缝循环。
CARD_MOTIONS: dict[str, str] = {
    # 一级：原石
    "L1-17": "the prospector gently swirls the pan, water ripples, the diamond glints",
    "L1-18": "the miners push the cart a little forward and back, lantern light flickers",
    "L1-19": "the miner swings the pickaxe, ice shards fly, the crystal glints",
    "L1-20": "the geologist leans closer with the magnifying glass, the gem twinkles",
    "L1-21": "the worker shakes the sieve side to side, dirt falls through, small gems glint",
    "L1-22": "the lantern sways slowly on its rope, the veins sparkle in its light",
    "L1-23": "the girl lifts the gem a little, it sparkles, her hair moves in the breeze",
    "L1-24": "the geode glows and pulses, sparkles drift up, the miners shift their weight",
    "L1-09": "the stream flows and ripples around the miner, the gem glints in his hand",
    "L1-10": "the miner and the mule keep walking along the mountain path, their legs stepping, the ore sack on the mule bounces, the mule nods its head and swishes its tail, the blue gem rocks beside the path twinkle",
    "L1-11": "the miner swings the pickaxe into the wall, rock chips fly, crystals glint",
    "L1-12": "water runs down the sluice box, the woman rocks it gently, gems glint",
    "L1-13": "the prospector strikes the stake with the hammer, small dust puffs",
    "L1-14": "the rope pulley turns, the basket rises a little and settles, gems twinkle",
    "L1-15": "the apprentice reaches toward the glowing gem, leaves sway gently",
    "L1-16": "lanterns flicker, crystals shimmer one after another across the cave",
    "L1-25": "the drill vibrates against the cliff, dust puffs, crystals glint",
    "L1-26": "the worker raises the gem higher, it sparkles, others keep digging",
    "L1-27": "the chisel taps the rock, a small crack glows, the gem flashes",
    "L1-28": "river water flows and ripples, gems in the water sparkle",
    "L1-29": "the miners bob slightly as they walk with the stretcher, the gem pulses",
    "L1-30": "the miner turns a stone in his fingers, the tent flaps gently",
    "L1-31": "the miner climbs one rung and settles, the vein glows brighter and dimmer",
    "L1-32": "the veins in the rock pulse with light, mist drifts at the entrance",
    "L1-33": "the tiny miner walks toward the red gem, small sparkles twinkle on the gem and along the red walls, dust drifts",
    "L1-34": "the workers shovel gravel into the cart, torches flicker",
    "L1-35": "the miner raises and lowers his pickaxe and chips at the rock, small pebbles and dust fall around him",
    "L1-36": "the miner swings his hammer at the red vein, small sparks fly from the rock, the lantern flame flickers",
    "L1-37": "the old woman swirls the basin, water ripples, gems glint",
    "L1-38": "the fuse sparks and fizzles, the others peek out from behind the crates",
    "L1-39": "the miner turns the gem slowly in the lamplight, it sparkles, the flame flickers",
    "L1-40": "lava glow pulses, crystals shimmer, embers drift upward",
    "L1-01": "torchlight flickers, the miner digs, the onyx glints",
    "L1-02": "the miners heave the block onto the sled, dust puffs",
    "L1-03": "embers drift in the warm light around the black onyx, small white glints travel across its facets, pebbles tremble on the ground",
    "L1-04": "the campfire flickers, the prospector traces the map with a finger",
    "L1-05": "the miner crawls forward a little, the vein ahead glints",
    "L1-06": "the workers sort stones, river water flows by",
    "L1-07": "the chisel taps the cliff, embers drift from the volcano",
    "L1-08": "the raft bobs on the water, lanterns sway, the crystal shimmers",
    # 二级：加工
    "L2-13": "the mallet strikes the chisel, the gem splits with a flash of light",
    "L2-14": "the jeweler tilts the gem under the loupe, it sparkles",
    "L2-15": "the lap wheel spins, the apprentice's foot pumps the pedal, sparkles fly",
    "L2-16": "the tweezers press the gem into the ring setting, a small sparkle",
    "L2-17": "the stone wheel spins, dust sprays, the half-cut diamond catches the light",
    "L2-18": "the artisans saw and chisel, sparks and stone dust fly",
    "L2-07": "the bow saw moves back and forth, dust falls, the cut face glints",
    "L2-08": "the engraving tool moves across the gem, tiny sparks flash",
    "L2-09": "the grinding wheel spins, water sprays, the sapphire glints",
    "L2-10": "the calipers adjust slightly, the appraiser leans in, the stone glints",
    "L2-11": "the chisel taps, chips fly, the candle flickers",
    "L2-12": "the wheels spin, sparks fly, the forge glow pulses",
    "L2-19": "the wheel spins, water splashes, the gem shines",
    "L2-20": "the file scrapes back and forth, dust falls from the vise",
    "L2-21": "the apprentices move gems into the trays, the gems twinkle",
    "L2-22": "the brush draws a line on the gem, the gem glows softly",
    "L2-23": "the engraving tool moves, tiny chips sparkle, the evening light shimmers",
    "L2-24": "the lathe spins the orb, light swirls across its surface",
    "L2-25": "the hammer strikes the wedge, the gem cracks open with a red flash",
    "L2-26": "the bow drill saws back and forth, the bead spins and glints",
    "L2-27": "the furnace flames flicker, the gem glows hotter and cooler",
    "L2-28": "the lap wheel spins, light flashes from the facets",
    "L2-29": "the hammer taps the pick, sparks fly, rock chips fall",
    "L2-30": "the big wheel turns, water and dust spray",
    "L2-01": "the chisel strikes, chips fly, the stone gleams",
    "L2-02": "the wire saw moves back and forth, a thin slice glints",
    "L2-03": "the hammer strikes the chisel, sparks fly, the geode cracks a little",
    "L2-04": "the craftsman grinds the black stone block back and forth on the workbench, stone dust drifts in the lamp light, white glints twinkle on the dark stone",
    "L2-05": "the candle flickers, the engraving tool moves, the seal gleams",
    "L2-06": "the stone wheel spins, sparks fly, the obsidian gleams",
    # 三级：魔法成品
    "L3-09": "the tiara floats up and down, sparkles orbit it, moonlight shimmers",
    "L3-10": "the pendant bobs above the book, runes rise and fade",
    "L3-11": "light beams pulse from the crown, sparkles drift",
    "L3-12": "the gem pulses like a heartbeat, stars twinkle around it",
    "L3-05": "magic crackles around the staff tip, the gem pulses",
    "L3-06": "the ring floats and spins slowly, light ripples spread across the pool",
    "L3-07": "the armillary rings rotate slowly, constellations twinkle, the orb glows",
    "L3-08": "lightning crackles around the scepter, the gem flashes",
    "L3-13": "the vine sways and grows a little, the amulet pulses with light",
    "L3-14": "glowing leaves swirl around the floating crown",
    "L3-15": "magical light overflows and swirls from the chalice",
    "L3-16": "the jewel floats up and down, runes glow and fade around it",
    "L3-17": "magical flames swirl around the brooch, the gems flicker",
    "L3-18": "small red flames flicker along the edges of the sword, tiny embers drift upward, the gems on the hilt twinkle",
    "L3-19": "the heart pendant pulses with light like a heartbeat",
    "L3-20": "the egg glows and pulses, heat shimmers, coins glint",
    "L3-01": "the crown floats up and down, golden magic light pulses behind it, the small gems twinkle",
    "L3-02": "void swirls rotate around the ring, light bends",
    "L3-03": "the raven's eyes glow, the aura pulses",
    "L3-04": "the inlaid gems on the throne pulse with mystic light one after another",
}


def build_card_motion(card_id: str) -> str:
    return CARD_MOTIONS[card_id]

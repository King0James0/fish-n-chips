# Fish N Chips

*A bioluminescent descent.* An entry for **GitHub Game Off 2026** — theme: **SHIFT**.

You are a creature of the deep that can **shift** between three forms. Each form survives what the
others cannot, each one *sees* the trench differently, and each one *fights* differently. Shift to
descend.

![title](art/store/01_title.png)

---

## The shift mechanic

Three interpretations of the theme, folded into one verb:

| Form | Body | Sees | Survives | Ability | Weapon |
|---|---|---|---|---|---|
| **Eel** | slim, fast | a small halo | narrow gaps | **Dash** | **Bio-electric zap** — fast, piercing |
| **Angler** | bulky, slow | a wide lure-light that **reveals hidden rock** | open water | **Flare** — stuns, costs 2 sparks | **Lure bolt** — slow, explodes on impact |
| **Jelly** | drifting | a soft glow | the **burning anemone curtain** | **Pulse** — an upward thrust | **Nematocyst cloud** — a spreading, homing spray |

Press **`Shift`** to cycle through the three forms in order (eel → angler → jelly → …).

The world is lit *only* by what you carry. Rock is a black silhouette; the angler's lure is the
only thing that exposes blocks that are otherwise invisible — so the same geometry is a different
test depending on which creature you are at that moment.

## Combat

You aim in **360 degrees** and every creature rotates to face where you aim (the cursor, the
right analog stick, or your heading if you use neither). Each form fires differently — see the
weapon column above. Enemies have health now and can be cleared, but the game stays a descent:
shooting is a tool, not a replacement for choosing the right form.

- **Viperfish** charges whatever it can see — break line of sight or shoot it.
- **Lanternfish** homes on your glow — flare it off or drop it behind rock.
- **Stinger** is a timed tentacle gate — wait for it to retract, or shoot the bulb to stun it.
- **Dragonfish** and **urchins** patrol and punctuate the dark.

### Power-ups

Glowing sigils grant a temporary power and **change your colour** so you can feel it working:

- **Overcharge** (gold) — double damage, piercing shots
- **Storm** (violet) — 2.4× fire rate
- **Aegis** (cyan) — one death forgiven

### The Matriarch

Act VII is a boss arena. **THE MATRIARCH** is a colossal angler-jelly hybrid that stalks you and
spits light. Do not touch her — shoot her. She enrages at half health. The beacon stays cold until
she is slain.

## How to play

- **Move** — `WASD` / arrow keys, left analog on a gamepad
- **Aim** — mouse cursor, right analog, or just your heading
- **Fire** — hold the **mouse button** or **`F`**, or the right trigger on a gamepad
- **Shift form** — `SHIFT` to cycle (eel → angler → jelly)
- **Ability** — `SPACE` (or gamepad `A`)
- **Restart act** — `R` · **Mute** — `M` · **Toggle bloom** — `B`
- Touch: on-screen stick + SHIFT / USE / FIRE buttons appear on phones and tablets

Collect **plankton** for sparks (the angler's ammunition), touch **checkpoints** to move your
respawn, and reach the **spawning beacon** at the end of each act.

**Eight acts:** The Trench → The Drift → The Lure → The Gauntlet → The Ascent → The Hollow →
The Matriarch → The Surface.

## Running it

It is a plain static web game — no build step, no bundler, no install (PixiJS is vendored in `vendor/`).

```bash
# any static server works, e.g.
python3 -m http.server 8000
# then open http://localhost:8000
```

The game boots from `pixi.html` — the sole build. `index.html` just redirects to it.

## Layout

```
pixi.html         sole build: Pixi host + scene wiring + touch controls (index.html redirects here)
css/style.css     page chrome, touch controls
js/main.js        engine: input, physics, collision, lighting, creatures, combat, boss, HUD (no draw)
js/renderer.js    native PixiJS draw layer: scene graph, sprites, filters, HUD/overlays
js/levels.js      level maps (GENERATED — do not hand-edit)
js/audio.js       procedural music sequencer + ocean soundscape + combat SFX, all synthesized
art/bg/           the eight act background images (the only art the game loads)
art/logos/        title-logo concepts (marketing)
art/store/        store-page screenshots
tools/gen_levels.py     builds js/levels.js and validates every map (bounds + reachability)
tools/smoke_test.py     headless runtime test (Playwright) + screenshots
```

### Levels

Maps are authored as ASCII grids in `tools/gen_levels.py` and emitted to `js/levels.js`. The
generator asserts that every tile is in bounds, that no item is placed inside terrain, and — via a
breadth-first flood fill from the spawn — that every goal, checkpoint, power-up and the boss is
actually **reachable**. A broken level fails loudly at build time instead of silently in-game.

```bash
python3 tools/gen_levels.py
```

Legend: `#` rock · `.` water · `^ v < >` current · `a` anemone · `h` hidden block · `*` plankton ·
`S` spawn · `D` checkpoint · `G` beacon · `P` power-up · `B` boss · `U` urchin · `F` dragonfish ·
`V` viperfish · `L` lanternfish · `T` stinger · `b` ambient bulb

### Tests

`tools/smoke_test.py` serves the game, drives it in headless Chromium, and asserts the rules that
actually matter:

- zero console/page errors across load, play and all form changes
- all eight acts have a reachable goal that fires the act-clear transition
- the 1-tile gap admits the eel and jelly but **not** the angler (form choice is mechanical)
- eel burns in the anemone curtain while jelly passes it
- a held shot actually **kills** an enemy (projectiles collide and deal damage)
- a power-up changes the player's active colour
- the boss takes damage, enrages, spawns orbs, and its beacon is **gated** until she dies
- aiming left/up rotates the creature to face left/up (full 360-degree aim)
- 400 simulated frames with repeated form shifts stay stable (bounded particles, no errors)

```bash
/opt/venv/bin/python tools/smoke_test.py   # needs playwright + chromium
```

## Rendering approach

The draw layer is **native PixiJS** (WebGL) — a real scene graph of containers, `Graphics` and
pooled sprites, not a blitted canvas frame. Everything is still generated at runtime; there is no
art or asset pipeline:

- the world is a Pixi `Container` (the camera) holding per-layer `Graphics` for water, ruin
  backgrounds, baked rock, currents, creatures and the player
- darkness is an offscreen `RenderTexture` with soft holes punched by `blendMode: 'erase'`, then
  composited as one sprite, so the trench is genuinely dark and your body is the light source
- two-tier **bloom** (world → render target → two blurred additive sprites), **volumetric god
  rays**, and a **vignette** of stroked annulus bands
- a `DisplacementFilter` scrolls a procedural noise texture for **water shimmer**, and a
  per-act `ColorMatrixFilter` gives each descent its own colour grade
- creatures are drawn as dark silhouettes with glowing rims, fins, teeth and tentacles — anatomy
  that survives the bloom, rotating to face your aim
- pooled additive sprites carry plankton, form-shift bursts, muzzle flashes, projectiles and
  shock rings; drifting motes, animated anemone curtains and caustic bands complete the scene

## Sound

Also entirely synthesized with the Web Audio API — no sound files in the repo:

- a **music sequencer** (sparse pentatonic bells over a slow chord pad) that grows denser and
  sprouts a heartbeat kick during the boss fight
- a layered **ocean bed**: a breathing deep swell, bandpassed water hiss, random whale calls and
  bubble pops
- a feedback-delay reverb send on bells, whales and power-up chimes
- per-form weapon SFX, hits, enemy deaths, boss roar

## Game Off 2026 notes

- **Theme interpretation:** *shift* as shapeshifting, as the light you carry, as shifting between
  surviving and fighting, and as the literal `Shift` key binding — one mechanic, many meanings.
- **Engine:** PixiJS (WebGL) for rendering; vanilla ES modules for logic + Web Audio. No bundler.
- **AI disclosure (required by the jam):** this project was built with an AI coding assistant
  (Agent Zero). The assistant wrote the engine, the level generator, the tests and this README,
  and ran the headless verification; the concept, theme interpretation and design direction were
  chosen by the human author. No AI-generated art or audio assets are used — everything on screen
  and in the speakers is generated by the code at runtime.

## License

MIT — see [LICENSE](LICENSE).

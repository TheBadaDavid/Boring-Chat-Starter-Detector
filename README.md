# Boring starter detector (React + Vite, 3D)

You pick guy or girl, and a random person (new name and new clothes every chat) starts chatting with you. Keep the **vibe** up. If it sinks to *very boring*, they storm off.

## The rules

- The chat has a **vibe meter (0-100)** that starts at **Normal (55)** and keeps going until it reaches **Very boring (under 30)**. Then Tolu says something rude and walks off.
- Every message you send is scored out of 100 and pushes the vibe up or down. Good messages in a row **snowball** (momentum bonus, and an extra bump once the chat is already lively). When the chat is lively, one dull message hurts less.
- Levels: 💀 Dead boring (under 10), 🥱 Very boring (under 30), 😐 Boring (under 50), 🙂 Normal (under 65), 😄 Lively (under 80), 🤩 Very lively (80+).
- **The level decides how Tolu talks (vibe for vibe).** Dry one-liners with no question when it's boring, normal and polite in the middle, chatty, excited and joking when it's lively. Tolu also copies a bit of your style (laughing, emoji, shouting with excitement).
- Tolu **answers what you actually said**. Ask "how are you?" and Tolu says how they are and asks something back. Say "I support Chelsea" and Tolu talks football. Answer Tolu's question well and you earn bonus points.
- Remarks like "Hmm, that's not it" and the "why did my message score this?" breakdown never appear in the chat. They show in the **mood panel** above the scene.
- Vibe 65+ → Tolu **sits down next to you** on the bench (hearts, 😍). Vibe sinking through Boring → Tolu looks bored (😒, hands on hips), then annoyed (😤, arms crossed, foot tapping), then leaves (😡).

## The 3D park

- Real 3D (three.js): both people are built from simple shapes and animated by code (walking in, gesturing while talking, sitting, crossing arms, stomping off). Outfits, skin and hair are random every chat.
- **Time of day changes.** Starts at your real local time, then runs fast (a day in about 4 minutes). The sun and moon cross the sky, sky colours, light and shadows follow, stars come out, street lamps and building windows light up at night. Click the clock at the top to switch Auto / Fast / Paused.
- **Things move in the background:** clouds drift, trees sway, birds fly by, cars drive past on the far road, and random passers-by (some jogging) walk along the path.
- **Hover (or tap) things to interact:** the two people wave and look at you (tooltip shows Tolu's mood), passers-by wave back, trees shake and drop leaves, clouds puff up, lamps switch on, birds flap away, cars beep. Click a person to make them hop. Moving the pointer gently shifts the camera for a depth effect.
- Reduced motion (OS setting): no wandering, no time cycle, people just appear.

## Run it (Vite)

```bash
npm create vite@latest chat -- --template react
cd chat
npm install
npm install three
```

Then copy these four files from this folder into `src/`:

1. `App.jsx` (replace the existing one)
2. `App.css` (replace the existing one)
3. `chatEngine.js` (Tolu's brain)
4. `world3d.js` (the 3D park)

Open `src/main.jsx` and delete the line `import './index.css'`. Delete `src/index.css` too (`App.css` already styles `html`, `body` and `#root`).

```bash
npm run dev
```

`index.html` is the same game as one standalone file with no build. Open it in a browser. It loads three.js from a CDN (jsdelivr), so it needs internet for the 3D scene. If that fails the chat still works.

## Where things live

Every file is commented. Quick map:

- `App.jsx`
  - `analyze`: scores ONE message (0-100) with reasons. Edit `GREETINGS`, `HOOKS` and the points inside it.
  - `LEVELS`, `levelOf`: the six levels and their score ranges.
  - `START_VIBE`, `LOSE_BELOW`: where the vibe starts (55) and where Tolu leaves (30). Change them to make the game easier or harder.
  - `nextVibe`: how a message moves the vibe (momentum and cushion are here).
  - `REMARKS`, `EXIT_LINES`: Tolu's remarks (mood panel) and last words (chat).
  - `NAMES`, `makeOutfit`, `newLook`: the random name and outfits, re-rolled every chat.
  - `respond`: the game turn: score → vibe → reply or leave → update the panel and the 3D scene. The reply tone is the average of the vibe's level and the message's level.
  - `World`, `Mood`: the 3D wrapper and the mood panel.
  - `them` (in `App`): Tolu is drawn as the opposite of the gender you pick. Change that one line to change it.
  - `phase`: `pick` → `idle` → `waiting` → `judging` → `idle` ... or `boring` (Tolu left).
  - `fakeApiSend`: the fake backend. Replace it with `fetch` or a WebSocket later. The "Flaky network" box still works.
- `chatEngine.js`: Tolu's brain. `makePersona` rolls who Tolu is (city, job, favourite food, team...). `rules` inside `makeBrain` are checked top to bottom (greetings, how-are-you, name, age, where-from, favourites, "do you like X", feelings, compliments, jokes, "I like/hate/went to X", "what about you?"...). `TOPICS` holds what Tolu says about each topic. It is rule-based and runs locally. To use a real AI later, replace `reply` with a call to your API (send the text, the persona and the tone level).
- `world3d.js`: the 3D park. Sections are numbered in the comments: sky and clock, ground, trees/lamps/bench, clouds, birds and cars, sprites (emoji, bubbles, hearts), the human builder, the two characters, passers-by, hover handling, the animation loop. `createWorld(THREE, element)` returns `setLook`, `setMood`, `setTyping`, `dispose`.
- `App.css`: sections for colours, top bar, mood panel, 3D world, chat, composer and the gender prompt. Dark mode and `prefers-reduced-motion` are handled.

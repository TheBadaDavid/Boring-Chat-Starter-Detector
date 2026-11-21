// =====================================================================================
//  App.jsx  -  the chat game
// =====================================================================================
//  THE GAME IN ONE PARAGRAPH
//  You pick guy or girl and a random person (Tolu, with a new name and outfit every chat)
//  starts chatting with you. The chat has a VIBE meter from 0 to 100 that starts at
//  "Normal" (55). Every message you send is scored (analyze) and pushes the vibe up or down
//  (nextVibe). Good messages in a row snowball; boring ones drag it down. If the vibe sinks
//  below 30 ("Very boring") Tolu storms off and the chat is over. If it climbs to "Lively"
//  (65+) Tolu sits down next to you on the bench. The level also sets Tolu's TONE: dry and
//  short when it is boring, chatty and excited when it is lively (vibe for vibe).
//
//  FILES
//    App.jsx        this file: scoring, vibe, game flow, the chat UI
//    chatEngine.js  Tolu's brain: writes the replies (see that file)
//    world3d.js     the 3D park, people, time of day and hover effects (see that file)
//    App.css        all the styling
// =====================================================================================
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";                       // 3D engine (npm install three)
import "./App.css";
import { makePersona, makeBrain } from "./chatEngine.js";
import { createWorld } from "./world3d.js";

// ---------- LEVELS ----------
// Both single messages and the overall vibe are put on this 6-step scale:
//   0 Dead boring (<10) | 1 Very boring (<30) | 2 Boring (<50) | 3 Normal (<65) | 4 Lively (<80) | 5 Very lively (80+)
const LEVELS = [
  { emoji: "💀", label: "Dead boring" }, { emoji: "🥱", label: "Very boring" }, { emoji: "😐", label: "Boring" },
  { emoji: "🙂", label: "Normal" }, { emoji: "😄", label: "Lively" }, { emoji: "🤩", label: "Very lively" },
];
const levelOf = (n) => (n < 10 ? 0 : n < 30 ? 1 : n < 50 ? 2 : n < 65 ? 3 : n < 80 ? 4 : 5);

// ---------- VIBE SETTINGS (change these to make the game easier or harder) ----------
const START_VIBE = 55;   // every chat starts in the middle of "Normal"
const LOSE_BELOW = 30;   // the vibe falls under this ("Very boring") -> Tolu walks off

// ---------- MESSAGE SCORING ----------
// Words and patterns the scorer looks for. Edit these lists to change what counts as boring.
const GREETINGS = ["hi","hii","hey","heyy","hello","hola","yo","sup","wassup","whats up","what's up","wyd","hru","good morning","good afternoon","good evening","good night","morning","evening","hi there","hey there","hello there","how are you","how are you doing","how are u","how r u","how you doing","how's it going","how is it going","hows it going","how was your day","how was ur day","how's your day","how is your day","how far","how you dey","how body","how una dey","wetin dey","what are you doing","what are you up to","what u doing","what's good","whats good","u there","you there","are you there","are you free","can we talk","are you okay","are you ok","u good","you good","nice pic","nice dp","nice picture","long time","i'm bored","im bored","my name is","i'm","im","i am"].sort((a, b) => b.length - a.length);
const FILLER = new Set(["there","please","pls","plz","dear","ma","sir","bro","oga","babe","my","friend","friends","guys","today","tonight","now","again","so","the","a","an","is","it","u","you","your","ur","you're","youre","are","am","and","to","me","we","can","just","really","hope","doing","well","fine","good","how","i"]);
const HOOKS = /\b(would you rather|hot take|unpopular opinion|be honest|settle (a|this)|random question|quick question|serious question|okay but|ok but|fun fact|confession|two truths|recommend|favou?rite|last time|worst|best|funniest|weirdest|craziest|most|story|guess what|bet you|debate|dare|challenge|what would you)\b/i;
const YES_NO = /^(do|does|did|are|is|can|will|have|has|was|were|should|could|would)\b/;
const ASKING = /^(what|why|how|who|where|when|which|tell me|name|describe|explain|guess|recommend|convince me|pick)\b/;
const LOOKS = /\b(you('?re| are| r)|u r|ur) (so |very |really )?(beautiful|pretty|cute|fine|hot|sexy|handsome|gorgeous|fit)\b|\bnice (pic|dp|picture|photo)\b|\blooking (good|fine|nice)\b/i;

// analyze(): looks at ONE message and gives it a score from 0 to 100, plus the reasons.
//   opts.answering = true when Tolu just asked a question (answering it well earns points).
// It only judges the message. How the score moves the chat's overall vibe is nextVibe() below.
function analyze(raw, opts = {}) {
  const text = raw.trim();
  const norm = text.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9'\s]/g, " ").replace(/(.)\1{2,}/g, "$1").replace(/\s+/g, " ").trim();
  const wc = norm ? norm.split(" ").length : 0;
  let score = 45;                                  // every message starts from a neutral 45
  const reasons = [];
  const add = (pts, good, label, tag) => { score += pts; reasons.push({ good, label, tag }); };

  // Is it just a greeting (plus a name or filler)?
  let rest = " " + norm + " ", hits = 0;
  for (const p of GREETINGS) {
    const needle = " " + p + " ";
    while (rest.includes(needle)) { rest = rest.replace(needle, "  "); hits++; }
  }
  const leftover = rest.split(" ").filter((t) => t && !FILLER.has(t));
  const generic = hits > 0 && leftover.length <= 1;

  const hook = HOOKS.test(text);
  const question = /\?/.test(text) || ASKING.test(norm) || YES_NO.test(norm);
  const yesNo = YES_NO.test(norm) && wc <= 6 && !hook;
  const looks = LOOKS.test(text);
  const letters = text.replace(/[^A-Za-z]/g, "");
  const shouting = letters.length >= 6 && letters === letters.toUpperCase();
  const specific = !generic && (/\d/.test(text) || /["“”]/.test(text) || /\s[A-Z][a-z]{2,}/.test(text.replace(/[.!?]\s+[A-Z]/g, " x")));
  const funny = /(lol|lmao|haha|😂|🤣|😅|😭|😜|🙈)/i.test(text);

  if (generic) add(-40, false, "Generic greeting. Everyone starts with this.", "generic");
  if (wc <= 1) add(-30, false, "One word gives them nothing to reply to.", "short");
  else if (wc <= 3) add(-12, false, "Very short. There's not much to react to.", "short");
  else if (wc >= 8 && wc <= 40) add(10, true, "Enough substance to reply to.");
  else if (wc > 60) add(-10, false, "Too long. Save some of the story for later.", "long");
  if (question && !generic && !yesNo) add(15, true, "Asks something they can answer.");
  if (yesNo) add(-8, false, "A yes/no question gets a one-word answer.", "yesno");
  if (hook) add(12, true, "Has a hook that invites an answer.");
  if (specific) add(10, true, "Specific details make it feel real.");
  if (funny) add(5, true, "Shows some personality.");
  // keeping the conversation going: you answered Tolu's question with more than a couple of words
  if (opts.answering && !generic && wc >= 3) add(10, true, "Answers their question and keeps it going.", "answers");
  if (looks) add(-15, false, "Looks-only compliment. They've heard it before.", "looks");
  if (shouting) add(-8, false, "ALL CAPS reads like shouting.", "caps");
  if (!reasons.length) add(0, false, "Nothing to react to yet. Add a question or a detail.", "flat");

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score < 10 ? 0 : score < 30 ? 1 : score < 50 ? 2 : score < 65 ? 3 : score < 80 ? 4 : 5;
  const { emoji, label } = LEVELS[level];
  const has = (t) => reasons.some((r) => r.tag === t);
  const tip = level >= 5 ? "Great energy. Keep it going with a story of your own after they answer."
    : level === 4 ? "Solid. A specific detail or a fun hook would make it even better."
    : level === 3 ? "Okay, but it doesn't stick yet. Add a specific detail, a hook, or an open question."
    : has("generic") ? 'Skip the plain greeting. Try something specific, like "Okay random question: what\'s the best thing you ate this week?"'
    : has("looks") ? "Compliment something they did or chose, not how they look."
    : has("yesno") ? "Ask an open question (what, why, how) instead of a yes/no."
    : has("short") ? "Add a detail or a question so they have something to answer."
    : "Ask about something specific, or share something funny or odd.";
  return { score, level, boring: level <= 2, lively: level >= 4, emoji, label, reasons: reasons.map(({ good, label }) => ({ good, label })), tip };
}

// nextVibe(): how one message moves the chat's overall vibe.
//   - a message's score above 50 pulls the vibe up, below 50 pulls it down (40 % of the gap)
//   - MOMENTUM: good messages (55+) in a row add a growing bonus, and once the chat is
//     already lively every good message counts for a bit more ("if it's going well, it snowballs")
//   - CUSHION: when the chat is lively, one dull message hurts less
// Returns the new vibe, how much it changed, and the current streak of good messages.
function nextVibe(vibe, streak, result) {
  const good = result.score >= 55;
  const newStreak = good ? streak + 1 : 0;
  let delta = (result.score - 50) * 0.4;
  if (good) delta += Math.min(8, (newStreak - 1) * 2) + (vibe >= 65 ? 3 : 0);
  else if (vibe >= 65) delta *= 0.7;
  const next = Math.max(0, Math.min(100, vibe + Math.round(delta)));
  return { vibe: next, delta: next - vibe, streak: newStreak };
}

// ---------- SMALL HELPERS ----------
const GAP = 2 * 60 * 1000;                            // messages closer than 2 minutes are visually grouped
const pick = (arr, not) => { let x; do { x = arr[Math.floor(Math.random() * arr.length)]; } while (x === not && arr.length > 1); return x; };
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);   // unique id for messages
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---------- TOLU'S REMARKS ----------
// Shown in the mood panel above the scene, NEVER in the chat. One list per message level (0-5).
const REMARKS = [
  ["Is that all? 💀", "I felt my soul leave my body 💀", "That was... nothing."],
  ["Wow, that was dry 🥱", "I almost fell asleep 😴", "Please give me something to work with."],
  ["Hmm 😒 That's not it.", "Ehn? 🥱 You can do better than that.", "Meh. Try harder."],
  ["Okay, that's fine 🙂 Nothing special yet.", "Not bad, not exciting either.", "Decent. Surprise me next time."],
  ["Okay, that made me smile 😄", "Now we're talking! 😄", "Ha! I like that."],
  ["That was fantastic! 🤩", "Okay, you got me. I'm hooked 😍", "Stop, you're too funny 😂"],
];
const WIN_TAIL = " Come, sit 😄";                                    // the vibe just reached Lively
const DROP_TAIL = " The vibe dropped 😒";                            // it fell back below Lively
const DYING_TAIL = " The vibe is dying. One more like that and I'm gone 😤";
const OUT_REMARKS = ["The vibe is dead. I'm done 😠", "That's it, I'm out 😠"];
// Tolu's last words in the chat when the vibe hits Very boring.
const EXIT_LINES = ["Okay, I've had enough 😒 Bye.", "This conversation is going nowhere 🙄 I'm leaving.", "I'd have more fun talking to the wall. Bye 😤", "Ehn? That's all you've got? 😠 I'm out."];

// ---------- A NEW NAME AND NEW CLOTHES EVERY CHAT ----------
// Tolu is drawn as the opposite of the gender you pick, so the name matches that gender.
const NAMES = {
  f: ["Ada", "Amaka", "Kemi", "Zainab", "Bisola", "Chioma", "Ngozi", "Folake", "Temi", "Funke", "Ife", "Sade", "Halima", "Yetunde", "Nneka", "Blessing", "Titi", "Dami", "Lola", "Efe"],
  m: ["Emeka", "Tunde", "Chidi", "Seyi", "Kunle", "Femi", "Ibrahim", "Dayo", "Obinna", "Kola", "Tobi", "Segun", "Musa", "Bayo", "Ikenna", "Jide", "Tola", "Uche", "Wale", "Deji"],
};
const TOPS = ["#e4572e", "#2a9d8f", "#e9c46a", "#7b6cf6", "#f28482", "#3a86ff", "#ff9f1c", "#06a77d", "#b5179e", "#ef476f", "#118ab2"];
const BOTTOMS = ["#264653", "#3d405b", "#6d597a", "#2b2d42", "#5f7a61", "#8d6e63", "#1d3557", "#4a4e69"];
const SHOES = ["#ffffff", "#222831", "#d62828", "#f4a261"];
const HATS = ["none", "none", "cap", "beanie"];
const SKINS = ["#8d5524", "#a0673a", "#6f4120", "#c68642", "#5a3418", "#3e2412", "#e0ac69"];
const HAIRS = ["#15100d", "#1b1410", "#2b1d14", "#0d0b0a", "#3b2a1c"];

// One random outfit. `not` lets us avoid giving both people the same top colour.
// pants: 0 = bare legs (under a dress), 50 = shorts, 76 = long trousers / leggings.
// sleeve: 16 = short sleeves, 54 = long sleeves.
function makeOutfit(g, not) {
  return {
    top: pick(TOPS, not && not.top), bottom: pick(BOTTOMS), shoes: pick(SHOES), hat: pick(HATS), hatColor: pick(TOPS),
    skin: pick(SKINS), hair: pick(HAIRS), height: 0.88 + Math.random() * 0.08,
    sleeve: pick([16, 54]),
    pants: g === "f" ? pick([0, 0, 76]) : pick([50, 76, 76]),
  };
}
// Everything that changes between chats: Tolu's name and what both people wear.
function newLook(myGender, prevName) {
  const theirGender = myGender === "m" ? "f" : "m";
  const you = makeOutfit(myGender);
  return { name: pick(NAMES[theirGender], prevName), you, tolu: makeOutfit(theirGender, you) };
}

// Fake backend: slow, and sometimes fails ("Flaky network" checkbox). Swap this for fetch/WebSocket later.
async function fakeApiSend(flaky) {
  await sleep(500 + Math.random() * 1000);
  if (flaky && Math.random() < 0.35) throw new Error("Network error");
  return { id: uid() };
}

// The first message in every chat. `key` never changes, so React does not remount the row
// when a temporary id is swapped for the server id.
const makeSeed = (name) => [{ key: "seed", id: "seed", sender: "them", status: "sent", createdAt: Date.now(), text: `Hey, I'm ${name} 👋` }];

// The mood panel's starting content (before you have sent anything).
const startMood = () => ({ vibe: START_VIBE, result: null, remark: "The vibe starts at Normal. Keep it lively!", note: "Very boring ends the chat. Lively gets Tolu to sit with you." });

// ---------- THE 3D WORLD (React wrapper) ----------
// All the 3D work happens in world3d.js. This component just creates it once, then tells it
// what is going on: who the people are (look), the mood (mode/annoy) and whether Tolu is typing.
//   mode:  "idle" | "love" (sitting together) | "angry" (Tolu leaves)
//   annoy: 0 | 1 | 2   how bored/annoyed Tolu looks while idle
function World({ look, me, them, mode, annoy, typing }) {
  const host = useRef(null);
  const world = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try { world.current = createWorld(THREE, host.current); } catch { setFailed(true); return; }   // no WebGL? chat still works
    return () => { world.current && world.current.dispose(); world.current = null; };
  }, []);
  // Effects run in order: first (re)build the people, then apply the mood to them.
  useEffect(() => { world.current && world.current.setLook({ you: look.you, tolu: look.tolu, meGender: me, themGender: them, name: look.name }); }, [look, me, them]);
  useEffect(() => { world.current && world.current.setMood({ mode, annoy }); }, [mode, annoy, look]);
  useEffect(() => { world.current && world.current.setTyping(typing); }, [typing]);
  return <div className="world" ref={host}>{failed && <p className="world-fail">The 3D scene needs WebGL. The chat still works.</p>}</div>;
}

// ---------- THE MOOD PANEL ----------
// Sits above the scene (outside the chat). Shows the current vibe level + bar, what Tolu thinks of
// your last message, and (in the drop-down) why it got that score.
function Mood({ name, mood, over, onAgain }) {
  const level = levelOf(mood.vibe);
  const r = mood.result;
  return (
    <section className={`mood lvl-${level}`} aria-live="polite">
      <div className="mood-row">
        <span className="badge">{LEVELS[level].emoji} {LEVELS[level].label}</span>
        <span className="mood-score">vibe {mood.vibe}/100</span>
        <div className="lvls" role="img" aria-label={`Vibe level ${level + 1} of ${LEVELS.length}`}>
          {LEVELS.map((l, i) => <i key={l.label} className={i <= level ? "on" : ""} />)}
        </div>
        {over && <button className="again" type="button" onClick={onAgain}>New chat</button>}
      </div>
      <p className="remark"><b>{name}:</b> {mood.remark}</p>
      <p className="v-try">{mood.note}</p>
      {r && (
        <details>
          <summary>Why did my message score {r.score}?</summary>
          <ul className="why">{r.reasons.map((x, i) => <li key={i} className={x.good ? "" : "bad"}>{x.label}</li>)}</ul>
          <p className="tip">{r.tip}</p>
        </details>
      )}
    </section>
  );
}

// ---------- THE APP ----------
export default function App() {
  // --- state (things that make the screen update) ---
  const [gender, setGender] = useState(null);             // "m" | "f", asked before the chat starts
  // phase: pick (choosing gender) -> idle (you can type) -> waiting (your message is being sent)
  //        -> judging (Tolu is typing) -> back to idle ... or boring (Tolu left, chat over)
  const [phase, setPhase] = useState("pick");
  const [look, setLook] = useState(() => newLook("m"));    // Tolu's name + both outfits, re-rolled every chat
  const [mood, setMood] = useState(startMood);             // the vibe + Tolu's latest remark (shown in the mood panel)
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);             // show Tolu's typing dots
  const [draft, setDraft] = useState("");
  const [flaky, setFlaky] = useState(true);                // simulate a bad network
  const [unread, setUnread] = useState(false);             // "New messages" button

  // --- refs (values that must not trigger a re-render, or that timers need to read) ---
  const appRef = useRef(null);
  const listRef = useRef(null);
  const taRef = useRef(null);
  const stick = useRef(true);        // is the user scrolled to the bottom? (if yes, new messages auto-scroll)
  const flakyRef = useRef(flaky);
  flakyRef.current = flaky;
  const round = useRef(0);           // bumped on every new chat so old timers/replies from a previous chat are ignored
  const vibeRef = useRef(START_VIBE);// the current vibe, readable inside timers
  const streakRef = useRef(0);       // how many good messages in a row
  const brain = useRef(null);        // Tolu's brain (chatEngine.js): remembers the conversation, writes replies

  // --- values worked out from the state ---
  const canSend = phase === "idle";
  const level = levelOf(mood.vibe);
  // What the 3D scene should show: Tolu left -> angry; lively vibe -> sitting together; otherwise standing and chatting.
  const mode = phase === "boring" ? "angry" : level >= 4 ? "love" : "idle";
  // Tolu looks more and more annoyed as the vibe sinks through "Boring" (2 = about to leave).
  const annoy = phase !== "boring" && level === 2 ? (mood.vibe < 40 ? 2 : 1) : 0;
  const me = gender || "m";
  const them = me === "m" ? "f" : "m";   // Tolu is drawn as the opposite of what you pick. Change this line if you want otherwise.
  const name = look.name;
  const failed = messages.some((m) => m.sender === "me" && m.status === "failed");
  const placeholder =
    phase === "boring" ? `${name} left the chat 😤`
    : phase === "judging" ? `${name} is typing…`
    : phase === "waiting" ? (failed ? "Tap Retry on your message" : "Sending…")
    : "Type a message";

  const update = (key, patch) => setMessages((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  // Add a message to the chat list.
  function add(sender, text) {
    const id = uid();
    setMessages((ms) => [...ms, { key: id, id, sender, status: "sent", createdAt: Date.now(), text }]);
    if (sender === "them" && !stick.current) setUnread(true);   // the user is reading old messages: don't yank them down
  }

  // Run `fn` after `ms`, unless a new chat has started in the meantime.
  function later(fn, ms) {
    const r = round.current;
    setTimeout(() => { if (round.current === r) fn(); }, ms);
  }

  // Longer replies take a bit longer to "type".
  const typingTime = (out) => Math.min(2600, 800 + out.length * 18 + Math.random() * 500);

  function onScroll() {
    const l = listRef.current;
    stick.current = l.scrollHeight - l.scrollTop - l.clientHeight < 80;
    if (stick.current) setUnread(false);
  }

  // After the list changes, stay pinned to the bottom, but only if the user was already there.
  useLayoutEffect(() => {
    const l = listRef.current;
    if (stick.current) l.scrollTop = l.scrollHeight;
  }, [messages, typing]);

  // Auto-grow the textarea as you type.
  useEffect(() => {
    const t = taRef.current;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 120) + "px";
  }, [draft]);

  // While the gender prompt is open, the chat behind it cannot be tabbed into.
  useEffect(() => { appRef.current.toggleAttribute("inert", phase === "pick"); }, [phase]);

  // Ready for the next message. (Skip auto-focus on touch screens so the keyboard does not cover the scene.)
  useEffect(() => {
    if (phase === "idle" && window.matchMedia("(pointer: fine)").matches) taRef.current.focus();
  }, [phase]);

  // "Send" the message to the fake backend. On success Tolu reads it; on failure it shows "Retry".
  async function deliver(key, text) {
    const r = round.current;
    update(key, { status: "sending" });
    try {
      const saved = await fakeApiSend(flakyRef.current);
      if (round.current !== r) return;
      update(key, { id: saved.id, status: "sent" });   // swap the temporary id for the server id
      respond(text);
    } catch {
      if (round.current !== r) return;
      update(key, { status: "failed" });
    }
  }

  // ---- Tolu reads a message ----
  // 1. score the message, 2. move the vibe, 3. either Tolu leaves (vibe too low) or
  // writes a reply whose TONE follows the vibe, 4. update the mood panel and the 3D scene.
  function respond(text) {
    const result = analyze(text, { answering: brain.current.asking() });
    const { vibe: nextV, delta, streak } = nextVibe(vibeRef.current, streakRef.current, result);
    const prevLevel = levelOf(vibeRef.current);
    const newLevel = levelOf(nextV);
    const sign = delta >= 0 ? "+" : "";
    const note = `Your message: ${result.emoji} ${result.label} (${result.score}/100) · vibe ${sign}${delta}${streak >= 2 ? ` · 🔥 ${streak} good in a row` : ""}`;
    setPhase("judging");
    setTyping(true);

    // The vibe sank to "Very boring": Tolu does not answer, just says something rude and leaves.
    if (nextV < LOSE_BELOW) {
      later(() => {
        setTyping(false);
        vibeRef.current = nextV; streakRef.current = streak;
        setMood({ vibe: nextV, result, remark: pick(OUT_REMARKS), note });
        add("them", pick(EXIT_LINES));
        setPhase("boring");
        later(() => add("system", `${name} left the chat 😤`), 1500);
      }, 1200 + Math.random() * 700);
      return;
    }

    // VIBE FOR VIBE: the reply's tone is the average of the chat's overall level and this message's level.
    const tone = Math.round((newLevel + result.level) / 2);
    const out = brain.current.reply(text, tone);
    later(() => {
      setTyping(false);
      add("them", out);
      vibeRef.current = nextV; streakRef.current = streak;
      let remark = pick(REMARKS[result.level]);
      if (newLevel >= 4 && prevLevel < 4) remark += WIN_TAIL;            // they are about to sit down
      else if (newLevel < 4 && prevLevel >= 4) remark += DROP_TAIL;      // they stand up again
      else if (nextV < 40 && delta < 0) remark += DYING_TAIL;            // last warning
      setMood({ vibe: nextV, result, remark, note });
      setPhase("idle");
    }, typingTime(out));
  }

  // Send what is in the textarea.
  function send() {
    const text = draft.trim();
    if (!text || !canSend) return;
    const key = uid();
    stick.current = true;
    setPhase("waiting");
    setMessages((ms) => [...ms, { key, id: key, text, sender: "me", status: "sending", createdAt: Date.now() }]);
    setDraft("");
    deliver(key, text);
  }

  // New chat: new name, new clothes, a fresh brain, and the vibe back at Normal.
  function startChat(g) {
    const next = newLook(g, look.name);
    brain.current = makeBrain(makePersona(next.name, g === "m" ? "f" : "m"));
    round.current += 1;
    vibeRef.current = START_VIBE;
    streakRef.current = 0;
    stick.current = true;
    setLook(next);
    setMood(startMood());
    setMessages(makeSeed(next.name));
    setTyping(false);
    setDraft("");
    setUnread(false);
    setPhase("idle");
  }

  // "New chat" keeps your gender; "Restart" asks for it again.
  function restart(askGender) {
    if (!askGender) return startChat(me);
    round.current += 1;
    vibeRef.current = START_VIBE;
    streakRef.current = 0;
    setMood(startMood());
    setMessages([]);
    setTyping(false);
    setDraft("");
    setUnread(false);
    setPhase("pick");
  }

  function choose(g) {
    setGender(g);
    startChat(g);
  }

  function jumpToBottom() {
    stick.current = true;
    listRef.current.scrollTop = listRef.current.scrollHeight;
    setUnread(false);
  }

  return (
    <>
      <div className="app" ref={appRef}>
        {/* top bar: Tolu's name, the rules in one line, and the buttons */}
        <header className="top">
          <div>
            <h1>{name}</h1>
            <p className="sub">{`Keep the vibe up. If it sinks to very boring, ${name} walks off.`}</p>
          </div>
          <div className="tools">
            <label className="flaky">
              <input type="checkbox" checked={flaky} onChange={(e) => setFlaky(e.target.checked)} /> Flaky network
            </label>
            <button className="ghost" type="button" onClick={() => restart(true)}>↺ Restart</button>
          </div>
        </header>

        {/* the vibe level, Tolu's remark about your last message, and why (outside the chat) */}
        <Mood name={name} mood={mood} over={phase === "boring"} onAgain={() => restart(false)} />

        {/* the 3D park (behind) with the chat messages floating over its lower half */}
        <div className="wrap">
          <World look={look} me={me} them={them} mode={mode} annoy={annoy} typing={typing} />
          <ul className="list" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
            {messages.map((m, i) => {
              if (m.sender === "system") {
                return <li key={m.key} className="msg system"><span className="sys">{m.text}</span></li>;
              }
              const prev = messages[i - 1];
              const grouped = prev && prev.sender === m.sender && m.createdAt - prev.createdAt < GAP;
              const mine = m.sender === "me";
              const lastMine = mine && !messages.slice(i + 1).some((x) => x.sender === "me");
              return (
                <li key={m.key} className={`msg ${mine ? "me" : "them"} ${m.status}${grouped ? " grouped" : ""}`}>
                  {!grouped && <span className="stamp">{(mine ? "" : name + ", ") + fmt(m.createdAt)}</span>}
                  <div className="bubble">{m.text}</div>
                  {mine && m.status === "sending" && <span className="state">Sending…</span>}
                  {mine && m.status === "failed" && (
                    <span className="state">
                      Not sent. <button type="button" onClick={() => deliver(m.key, m.text)}>Retry</button>
                    </span>
                  )}
                  {lastMine && m.status === "sent" && <span className="state">Sent</span>}
                </li>
              );
            })}
            {typing && (
              <li className="msg them">
                <div className="bubble dots" aria-label={`${name} is typing`}><i /><i /><i /></div>
              </li>
            )}
          </ul>
          {unread && <button className="newbtn" type="button" onClick={jumpToBottom}>New messages</button>}
        </div>

        {/* the message box */}
        <div className="composer">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            disabled={!canSend}
            placeholder={placeholder}
            aria-label="Message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();   // Enter sends, Shift+Enter makes a new line
                send();
              }
            }}
          />
          <button className="send" type="button" onClick={send} disabled={!canSend || !draft.trim()}>Send</button>
        </div>
      </div>

      {/* "Are you a guy or a girl?" prompt shown before the first chat */}
      {phase === "pick" && (
        <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
          <div className="card">
            <h2 id="gate-title">Before you start</h2>
            <p>Are you a guy or a girl? I'll use it to draw you in the scene.</p>
            <div className="choices">
              <button type="button" className="choice" autoFocus onClick={() => choose("m")}><span aria-hidden="true">🙋‍♂️</span>Guy</button>
              <button type="button" className="choice" onClick={() => choose("f")}><span aria-hidden="true">🙋‍♀️</span>Girl</button>
            </div>
            <small>Nothing is saved. It only changes how the characters look.</small>
          </div>
        </div>
      )}
    </>
  );
}

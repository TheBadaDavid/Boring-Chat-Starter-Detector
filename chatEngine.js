// =====================================================================================
//  chatEngine.js  -  Tolu's brain
// =====================================================================================
//  Tolu answers what you ACTUALLY said, then (usually) asks something back.
//  It is rule-based and fully local (no AI service, no network).
//
//  The pieces:
//    makePersona(name, gender)  -> who Tolu is this chat (age, city, job, favourite food, team...)
//                                  so answers stay consistent ("Where are you from?" always
//                                  gets the same city within one chat).
//    makeBrain(persona)         -> { reply(text, level), asking() }
//        reply(text, level)     -> the reply string. `level` (0-5) is the TONE the conversation's
//                                  vibe calls for (see App.jsx):
//                                    0-1 dry (one short line, no question)   2 flat
//                                    3 normal                                4 lively
//                                    5 very lively (excited, emoji, jokes back)
//                                  The CONTENT of the reply always follows what you typed; the
//                                  level only changes the wording, warmth and whether a follow-up
//                                  question is added. That is the "vibe for vibe" part.
//        asking()               -> true if Tolu's last message ended with a question (the scorer
//                                  gives a bonus when you actually answer it).
//
//  How reply() works, step by step:
//    1. If the message is "statement, question?" (e.g. "I'm fine, what did you do today?")
//       it is split and BOTH halves are answered.
//    2. resolve() runs the message through `rules` from top to bottom. The first rule that
//       matches builds an answer: { short, ans, ask }
//           short = the one-liner used when the tone is dry
//           ans   = the full answer
//           ask   = a follow-up question { k: kind, t: text } (kind is remembered so the
//                   NEXT message can be read as an answer to it)
//    3. If no rule matches: answer a question Tolu asked earlier, talk about a topic you
//       raised, or pick your most interesting word and ask about it.
//    4. The answer is assembled for the tone (short only / answer / answer + question),
//       and finally mirror() copies a little of your style (laughing, emoji, excitement).
// =====================================================================================

const pick = (a, not) => { let x; do { x = a[Math.floor(Math.random() * a.length)]; } while (x === not && a.length > 1); return x; };
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
const firstSentence = (s) => (s.match(/^.*?[.!?](?=\s|$)/) || [s])[0];
const norm = (s) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();

// ---------- Who Tolu is (rolled once per chat, so answers stay consistent) ----------
const CITIES = ["Lagos", "Abuja", "Ibadan", "Abeokuta", "Port Harcourt", "Ilorin", "Enugu", "Benin City", "Kano", "Akure"];
const JOBS = ["I'm a graphic designer", "I'm a nurse", "I work in a bank", "I'm studying Computer Science", "I'm studying Law", "I run a small fashion business", "I'm a software developer", "I teach primary school", "I'm studying Mass Communication", "I'm a content creator", "I'm a photographer"];
const FOODS = ["jollof rice", "amala and ewedu", "suya", "pounded yam and egusi", "fried rice", "shawarma", "pizza", "moi moi", "pepper soup", "plantain and eggs"];
const GENRES = ["Afrobeats", "Amapiano", "R&B", "Highlife", "Hip hop", "Gospel"];
const ARTISTS = ["Burna Boy", "Tems", "Asake", "Rema", "Ayra Starr", "Wizkid", "Davido", "Omah Lay"];
const SHOWS = ["Nollywood movies", "anime", "crime thrillers", "comedy series", "K-dramas", "reality TV"];
const TEAMS = ["Arsenal", "Chelsea", "Man United", "Barcelona", "Real Madrid", "Liverpool"];
const HOBBIES = ["dancing", "reading novels", "cooking", "taking photos", "playing games", "going to the gym", "drawing", "travelling", "thrifting"];
const COLORS = ["blue", "green", "black", "yellow", "purple", "red"];
const DRINKS = ["zobo", "chapman", "fresh juice", "malt", "cold water"];
const ANIMALS = ["dogs", "cats", "horses", "birds"];
const DREAMS = ["Dubai", "London", "Cape Town", "Zanzibar", "Paris", "Accra"];
const DOINGS = ["sitting here enjoying the breeze", "relaxing on this bench", "people-watching", "taking a break from everything", "thinking about what to eat later"];
const WEEKENDS = ["sleep in and watch something", "meet up with friends", "cook something nice", "go out and explore a bit", "catch up on sleep"];
const MOODS = ["good", "fine", "great", "okay"];
const TODAYS = ["slept in and then went out for a walk", "worked for a bit and then relaxed", "met a friend for lunch", "stayed in and watched something", "cooked and cleaned up the house"];

export function makePersona(name, gender) {
  return {
    name, gender, age: 20 + Math.floor(Math.random() * 9), city: pick(CITIES), job: pick(JOBS), food: pick(FOODS),
    music: pick(GENRES), artist: pick(ARTISTS), show: pick(SHOWS), team: pick(TEAMS), hobby: pick(HOBBIES), color: pick(COLORS),
    drink: pick(DRINKS), animal: pick(ANIMALS), dream: pick(DREAMS), doing: pick(DOINGS), weekend: pick(WEEKENDS), mood: pick(MOODS), today: pick(TODAYS),
  };
}

// ---------- Topics: what Tolu says about herself/himself, and a question to keep the topic going ----------
const TOPICS = [
  { id: "food", re: /\b(food|eat|eating|ate|hungry|rice|jollof|suya|pizza|burger|soup|swallow|chicken|egusi|amala|noodles|cake|chocolate|shawarma|pasta|beans|plantain|yam|lunch|dinner|breakfast|snack|snacks|cook|cooking|meal|fufu|pap|akara|pepper)\b/,
    share: (p) => `I'm more of a ${p.food} person.`, ask: ["What do you eat when you're really hungry?", "What's the one meal you could eat every day?"] },
  { id: "music", re: /\b(music|song|songs|sing|singing|afrobeats|burna|wizkid|davido|rema|asake|tems|ayra|hip hop|rap|gospel|amapiano|r&b|playlist|album|concert|dance|dancing|band)\b/,
    share: (p) => `I'm mostly into ${p.music}, and ${p.artist} is always on my playlist.`, ask: ["Which artist could you listen to on repeat?", "What song have you been replaying lately?"] },
  { id: "movie", re: /\b(movie|movies|film|films|series|netflix|anime|nollywood|show|shows|drama|cartoon|cinema|watch|watching|watched|tv)\b/,
    share: (p) => `I'm into ${p.show} lately.`, ask: ["What's the last thing you watched that you couldn't stop thinking about?", "What are you watching these days?"] },
  { id: "sport", re: /\b(football|soccer|arsenal|chelsea|man u|manchester|barca|barcelona|madrid|liverpool|basketball|gym|messi|ronaldo|running|tennis|match|sport|sports|team|workout|exercise)\b/,
    share: (p) => `I support ${p.team}, so I've learnt to live with heartbreak 😂`, ask: ["Who do you support?", "Do you follow any team?"] },
  { id: "games", re: /\b(game|games|gaming|fifa|cod|pubg|ps5|playstation|xbox|minecraft|gamer|console)\b/,
    share: () => "I play sometimes, mostly when I'm with friends.", ask: ["What's the one game you could play for hours?"] },
  { id: "travel", re: /\b(travel|travelling|traveling|trip|vacation|holiday|beach|abroad|flight|london|dubai|canada|paris|visit|visited)\b/,
    share: (p) => `I'd love to travel more. ${p.dream} is top of my list.`, ask: ["What's the best place you've ever been to?", "If you could go anywhere right now, where would you go?"] },
  { id: "tech", re: /\b(code|coding|programming|computer|app|apps|phone|laptop|ai|tech|software|website|iphone|android)\b/,
    share: () => "I'm not super techy, but I love a good gadget.", ask: ["What got you into that?"] },
  { id: "animals", re: /\b(dog|dogs|cat|cats|pet|pets|puppy|kitten|horse|bird)\b/,
    share: (p) => `I'm a ${p.animal} person, honestly.`, ask: ["Do you have a pet?"] },
  { id: "work", re: /\b(exam|exams|class|school|university|lecture|assignment|office|boss|job|work|working|business|career|study|studying)\b/,
    share: (p) => `${p.job}, and some days are better than others.`, ask: ["How's it going for you so far?", "What do you like most about it?"] },
  { id: "weather", re: /\b(rain|raining|sun|sunny|hot|cold|harmattan|weather|breeze|cloudy|heat)\b/,
    share: () => "Right? This weather out here is something.", ask: ["Do you prefer hot weather or cool weather?"] },
  { id: "hobby", re: /\b(hobby|hobbies|free time|read|reading|draw|drawing|paint|painting|photography|thrift|thrifting|hiking|fishing)\b/,
    share: (p) => `I'm into ${p.hobby} myself.`, ask: ["How did you get into that?", "How often do you get to do it?"] },
];
const topicOf = (s) => TOPICS.find((t) => t.re.test(s));

// Questions Tolu can bring up on their own. Each topic is asked at most once per cycle.
const OPENERS = [
  { k: "day", t: ["How's your day been so far?", "How has your day been?"] },
  { k: "weekend", t: ["Any plans for the weekend?", "What are you doing this weekend?"] },
  { k: "hobby", t: ["What do you like doing when you're free?", "What do you do for fun?"] },
  { k: "food", t: ["What's your favourite meal?", "What's the best thing you've eaten this week?"] },
  { k: "music", t: ["What kind of music are you into?", "What have you been listening to lately?"] },
  { k: "movie", t: ["What was the last thing you watched that you really enjoyed?"] },
  { k: "team", t: ["Do you follow football?"] },
  { k: "job", t: ["What do you do, work or school?"] },
  { k: "where", t: ["Where are you from, by the way?"] },
  { k: "travel", t: ["If you could travel anywhere right now, where would you go?"] },
  { k: "fun", t: ["What's the funniest thing that's happened to you this week?"] },
];

const JOKES = [
  "Why don't skeletons fight each other? They don't have the guts 😂",
  "I told my phone I need space. Now it keeps saying 'storage almost full' 😂",
  "Why did the scarecrow win an award? He was outstanding in his field 😂",
  "I'm on a seafood diet. I see food and I eat it 😂",
  "My WiFi and I have a lot in common: we both disconnect when things get serious 😂",
];

const STOP = new Set("about after again also always because been before being between both could does doing done each even ever every from have having here into just like made make many more most much must never only other over really same should since some still such than that their them then there these they thing things think this those through very want well were what when where which while will with would your yours you're i'm it's that's don't can't".split(" "));
const POS = /\b(good|fine|great|okay|ok|well|nice|happy|alright|cool|amazing|better|blessed|awesome|fantastic|not bad|nothing much|can't complain|cant complain|doing well|all good)\b/;
const NEG = /\b(tired|sad|bad|stressed|sick|bored|terrible|rough|hungry|sleepy|angry|annoyed|exhausted|awful|horrible|not good|not fine|not okay|not great|so so|lonely|worried|down)\b/;
const YES = /^(yes|yeah|yep|yup|sure|of course|definitely|i do|ofcourse|yea|absolutely)\b/;
const NO = /^(no|nope|nah|not really|not at all|never|i don't|i do not|nay)\b/;

// "my" -> "your" so echoes read right
const swap = (s) => s.replace(/\bmy\b/gi, "your").replace(/\bmine\b/gi, "yours");
// Short noun-ish answers can be echoed back ("Jollof rice, nice!"). Sentences about "I" can't.
function echo(raw) {
  let s = raw.trim().replace(/[.!?]+$/, "");
  for (let i = 0; i < 3; i++) s = s.replace(/^(?:it'?s|its|it is|i think|maybe|probably|well|um+|uh+|erm|hmm+|so|like|just|mostly|mainly|definitely|honestly)[, ]+/i, "");
  s = s.trim();
  if (!s || /^(i|i'm|im|i've|ive|my|me|we|you|no|not|nothing|nah|don'?t|idk|dunno|yes|yeah|yep|ok|okay|fine|good|lol|haha)\b/i.test(s)) return null;
  if (s.split(/\s+/).length > 4 || /[,;:]/.test(s)) return null;
  return swap(s);
}
// The thing after "I like ..." / "I went to ...", trimmed to a short phrase.
function phrase(s) {
  let x = s.trim().replace(/[.!?]+$/, "").split(/[,;.!?]| but | because | cuz | and then /i)[0].trim();
  const w = x.split(/\s+/);
  if (w.length > 6) x = w.slice(0, 6).join(" ");
  return swap(x);
}

function favOf(cat, p) {
  const MAP = [[/colou?r/, p.color], [/food|meal|dish|eat|snack/, p.food], [/music|song|artist|singer|musician|band|rapper/, p.artist], [/movie|film|show|series|anime/, p.show], [/drink/, p.drink], [/animal|pet/, p.animal], [/team|club/, p.team], [/sport/, "football"], [/place|city|country|destination/, p.dream], [/game/, "FIFA"]];
  const hit = MAP.find(([re]) => re.test(cat));
  return hit ? hit[1] : null;
}

// level number -> tone name
const TIERS = ["dry", "dry", "flat", "normal", "lively", "hot"];

// Vibe for vibe: when the mood is good, copy a little of the way the user writes
// (laughing, emoji, shouting with excitement). Does nothing when the tone is dry or flat.
function mirror(out, user, tier) {
  if (tier === "dry" || tier === "flat") return out;
  const laughed = /(^|\s)(lol|lmao|lmfao|haha+|hehe+)|😂|🤣/i.test(user);
  const emoji = (user.match(/\p{Extended_Pictographic}/u) || [])[0];
  const letters = user.replace(/[^A-Za-z]/g, "");
  const loud = /!{2,}/.test(user) || (letters.length >= 6 && letters === letters.toUpperCase());
  if (laughed && !/^(haha|hehe|lol)/i.test(out)) out = "Haha! " + out;
  else if (loud && (tier === "lively" || tier === "hot")) out = pick(["Ooh! ", "Wow! "]) + out;
  if (emoji && !/\p{Extended_Pictographic}/u.test(out)) out += " " + emoji;
  return out;
}

export function makeBrain(p) {
  // mem = what Tolu remembers about this conversation
  //   user      your name, once you tell it
  //   lastAsk   the kind of question Tolu asked last (so your next message is read as its answer)
  //   preTopic  topic raised in the first half of "statement, question?" messages
  //   asked     which small-talk topics were already brought up (so Tolu does not repeat them)
  //   used      lines already said (so Tolu does not repeat the same sentence)
  //   queue     a shuffled order for bringing up new topics
  const mem = { user: null, lastAsk: null, preTopic: null, asked: new Set(), used: new Set(), queue: shuffle(OPENERS.map((o) => o.k)) };
  let tier = "normal";

  // Pick a line that hasn't been used yet this chat.
  const say = (arr) => {
    const list = Array.isArray(arr) ? arr : [arr];
    const fresh = list.filter((x) => !mem.used.has(x));
    const c = pick(fresh.length ? fresh : list);
    mem.used.add(c);
    return c;
  };
  // Choose wording by tone. Missing tiers fall back (hot -> lively -> normal, flat -> normal).
  const by = (o) => say(o[tier] || (tier === "hot" ? o.lively : null) || o.normal || o.flat);

  const nextAsk = () => {
    let k = mem.queue.find((q) => !mem.asked.has(q));
    if (!k) { mem.asked.clear(); mem.queue = shuffle(OPENERS.map((o) => o.k)); k = mem.queue[0]; }
    return { k, t: say(OPENERS.find((o) => o.k === k).t) };
  };
  const topicAsk = (t) => (t ? { k: t.id, t: say(t.ask) } : nextAsk());

  // A short reaction to what they just said, in the current tone.
  const ack = (text) => {
    const e = echo(text), E = e && cap(e);
    return by({
      flat: E ? `${E}. Okay.` : "Okay.",
      normal: E ? [`${E}, okay.`, `${E}? Alright.`] : ["Oh, okay.", "Alright."],
      lively: E ? [`${E}, nice!`, `Oh, ${e}! Nice.`] : ["Oh nice!", "Okay, cool!"],
      hot: E ? [`${E}! I love that.`, `Ooh, ${e}! Good one.`] : ["Oh, I love that!", "Okay, that's actually cool!"],
    });
  };

  const NOT_NAMES = /^(fine|good|okay|tired|happy|hungry|bored|sad|sick|busy|sorry|back|here|home|free|ready|single|married|serious|honest|great|well|glad|late|new|just|not|so|very|really|going|trying|looking|thinking|wondering|curious|interested|from|in|at|on|with|a|an|the)$/i;
  const nameFrom = (c) => {
    const m = c.t.match(/\b(?:my name is|my name's|call me|i am called|they call me|people call me)\s+([a-z][a-z'-]{1,15})/);
    if (m) return cap(m[1]);
    const n = c.r.match(/\b(?:[iI]'?m|[iI] am|[tT]his is)\s+([A-Z][a-z]{2,14})\b(?=\s*(?:[.!,;]|$|\s+(?:by the way|btw|here|nice|pleased|good)))/);
    return n && !NOT_NAMES.test(n[1]) ? n[1] : null;
  };

  // ---- RULES: checked top to bottom, the first `when` that matches wins ----------------
  // The order matters: specific things (rude words, "what's your name") come before general
  // ones (topics, fallbacks). `c` is the message: c.raw as typed, c.r with plain quotes,
  // c.t lower-cased and tidied. Inside `run`, by({...}) picks wording for the current tone.
  const rules = [
    // --- things people say that need a particular reaction ---
    { when: (c) => /\b(nudes?|naked|sext|sex)\b/.test(c.t), run: () => ({ ans: say(["Okay, that's a no from me 😒 Keep it respectful.", "Nope. Let's keep this respectful."]) }) },
    { when: (c) => /\b(bye|goodbye|good night|goodnight|gtg|got to go|gotta go|see you|see ya|cya|ttyl|talk later|i'?m leaving|i have to go)\b/.test(c.t),
      run: () => ({ short: "Bye.", ans: by({ flat: "Okay, bye.", normal: ["Okay, take care 👋", "Alright, see you around 👋"], lively: ["Aww, leaving already? Okay, take care 👋", "Already? Fine, go. Talk soon 👋"] }) }) },
    { when: (c) => /\b(ugly|stupid|idiot|dumb|fool|useless|annoying|shut up|hate you|mad person)\b/.test(c.t) && /\byou/.test(c.t) || /\bshut up\b/.test(c.t),
      run: () => ({ ans: say(["Wow. Rude 😒", "Excuse me? That was uncalled for 😒", "Okay, that's not nice."]) }) },
    { when: (c) => /\b(your (number|digits|phone number|whatsapp|snap|snapchat|insta|instagram|handle)|add me|dm me)\b/.test(c.t),
      run: () => ({ short: "Not yet.", ans: say(["Slow down 😂 we just met. Let's gist here first.", "Not so fast 😅 let's talk a bit first."]), ask: nextAsk() }) },
    { when: (c) => /\b(i love you|marry me|be my (girlfriend|boyfriend|wife|husband|babe)|date me|go out with me)\b/.test(c.t),
      run: () => ({ short: "Calm down.", ans: say(["Haha calm down 😂 we just met!", "Easy now 😅 let's start with a conversation first."]), ask: nextAsk() }) },
    { when: (c) => /\b(are you|you) (single|taken|married|dating)\b|\b(have|got) a (boyfriend|girlfriend|bf|gf|partner)\b/.test(c.t),
      run: () => ({ short: "That's personal.", ans: "That's quite personal 😂 We just met.", ask: { k: "open", t: "Why do you ask?" } }) },
    { when: (c) => /\b(are you (a )?(bot|robot|ai|real|human)|you'?re (a )?(bot|robot|ai))\b/.test(c.t),
      run: () => ({ short: "I'm real.", ans: say(["Lol what? I'm literally sitting right here 😂", "Haha I'm real o, look at me on this bench 😂"]), ask: { k: "open", t: "Why would you ask that?" } }) },

    // --- questions about Tolu ---
    { when: (c) => /\b(what'?s your name|what is your name|your name\?|who are you|may i know your name|can i know your name|what do they call you|wetin be your name)\b/.test(c.t),
      run: () => mem.user
        ? { short: `${p.name}.`, ans: `I'm ${p.name}, remember? 😄`, ask: nextAsk() }
        : { short: `${p.name}. You?`, retk: "name", ans: `I'm ${p.name}.`, ask: { k: "name", t: "And you, what's your name?" } } },
    { when: (c) => !!nameFrom(c),
      run: (c) => { mem.user = nameFrom(c); return { short: `Okay, ${mem.user}.`, ans: by({ flat: `Okay, ${mem.user}.`, normal: `Nice to meet you, ${mem.user}.`, lively: `Nice to meet you, ${mem.user}! 😊`, hot: `${mem.user}! Love that name. Nice to meet you 😊` }), ask: nextAsk() }; } },
    { when: (c) => /\b(how are you|how r u|how are u|how're you|how you doing|how do you do|how've you been|how have you been|how is your day|how's your day|how was your day|how's life|how is life|how are things|how's it going|how is it going|hows it going|how you dey|how body|how's everything|are you okay|are you ok|hru)\b/.test(c.t),
      run: () => {
        const glad = mem.lastAsk === "how_user" && (tier === "normal" || tier === "lively" || tier === "hot") ? "Glad to hear it. " : "";
        return {
          short: "Fine. You?", retk: "how_user",
          ans: glad + by({
            flat: "I'm fine.",
            normal: [`I'm ${p.mood}, thanks!`, "I'm doing okay, thanks for asking."],
            lively: ["I'm doing good, thanks for asking!", "I'm good o, just enjoying the breeze out here."],
            hot: ["I'm doing great, honestly! This chat is already helping 😄", "I'm amazing today, thanks for asking!"],
          }),
          ask: glad ? nextAsk() : { k: "how_user", t: by({ normal: "What about you, how are you?", lively: "What about you, how's your day been?", hot: "What about you? How's your day been so far?" }) },
        };
      } },
    { when: (c) => /\b(how old are you|what'?s your age|your age|how old r u)\b/.test(c.t),
      run: () => ({ short: `${p.age}. You?`, retk: "age", ans: `I'm ${p.age}.`, ask: { k: "age", t: "And you?" } }) },
    { when: (c) => /\b(where (are you|r u|you) from|where do you (live|stay)|where are you (based|located)|which city|what city|where you dey stay|your location)\b/.test(c.t),
      run: () => ({ short: `${p.city}. You?`, retk: "where", ans: say([`I'm from ${p.city}.`, `${p.city}, born and raised.`]), ask: { k: "where", t: "What about you, where are you from?" } }) },
    { when: (c) => /\b(wyd|what are you doing|what r u doing|what you doing|what are you up to|wetin you dey do|what'?s up|whats up|wassup|wats up|what's good)\b/.test(c.t) && c.t.split(" ").length <= 6,
      run: () => ({ short: "Nothing much. You?", retk: "doing", ans: by({ flat: `Nothing much, just ${p.doing}.`, normal: `Not much, just ${p.doing}.`, lively: `Just ${p.doing}. Perfect timing, actually!`, hot: `Just ${p.doing}, and now this chat is getting interesting 😄` }), ask: { k: "doing", t: "What about you, what are you up to?" } }) },
    { when: (c) => /\b(tell me a joke|got a joke|any joke|know a joke|make me laugh|say something funny)\b|^joke\b/.test(c.t),
      run: () => ({ short: "Not now.", ans: say(JOKES), ask: { k: "joke", t: "Your turn. Got one?" } }) },
    { when: (c) => /\b(?:what'?s|what is|what are|who'?s|who is) your (?:favou?rite|fav|best)\s+([a-z ]{2,20})/.test(c.t) || /\byour (?:favou?rite|fav) ([a-z ]{2,20})/.test(c.t),
      run: (c) => {
        const m = c.t.match(/your (?:favou?rite|fav|best)\s+([a-z ]{2,20})/);
        const cat = m[1].replace(/\b(is|are|and|then|though|ever|please)\b.*$/, "").trim();
        const val = favOf(cat, p);
        return val
          ? { short: `${cap(val)}.`, ans: `My favourite ${cat} is ${val}.`, ask: { k: "open", t: "What's yours?" } }
          : { short: "Can't pick.", ans: say(["Ooh, that's a tough one, I'd have to think about it.", "Hmm, I can't pick just one 😅"]), ask: { k: "open", t: "What's yours?" } };
      } },
    { when: (c) => /\bdo you (?:like|love|enjoy|play|watch|listen to|eat|drink|know|have|speak|read|go to|follow|support|use|cook|dance|sing|travel|swim|drive|own)\s+(.+)/.test(c.t),
      run: (c) => {
        const x = phrase(c.t.match(/\bdo you (?:like|love|enjoy|play|watch|listen to|eat|drink|know|have|speak|read|go to|follow|support|use|cook|dance|sing|travel|swim|drive|own)\s+(.+)/)[1].replace(/\?+$/, ""));
        const t = topicOf(x);
        if (t) return { short: "Yeah.", ans: t.id === "food" ? `Yeah, ${x} is good! ${t.share(p)}` : `Yeah! ${t.share(p)}`, ask: topicAsk(t) };
        return hash(x) % 4 !== 0
          ? { short: "Yeah.", ans: say(["Yeah, I do actually 🙂", "Yes, I do, sometimes."]), ask: { k: "open", t: `Are you into ${x} too?` } }
          : { short: "Not really.", ans: "Not really, it's not my thing.", ask: { k: "open", t: `What about you, do you like ${x}?` } };
      } },
    { when: (c) => /\bwould you rather\b.+\bor\b/.test(c.t),
      run: (c) => {
        const m = c.r.match(/would you rather\s+(.+?)\s+or\s+(.+?)[?.!]*$/i);
        const first = hash(c.t) % 2 === 0, o = m ? (first ? m[1] : m[2]) : null;
        return { short: "Second one.", ans: o ? say([`Ooh, that's a tough one. I'd go with ${first ? "the first" : "the second"}: ${o}.`, `Hmm, tough. I'd pick ${first ? "the first" : "the second"}: ${o}.`]) : "Ooh, that's a tough one.", ask: { k: "open", t: "What would you pick?" } };
      } },
    { when: (c) => /\bwhat (did|have) you (do|been up to|been doing)\b|\bdid you do anything\b/.test(c.t),
      run: () => ({ short: "Not much. You?", retk: "doing", ans: by({ flat: `Not much, I just ${p.today}.`, normal: `Not much, I just ${p.today}.`, lively: `Nothing crazy, I just ${p.today}.`, hot: `Nothing crazy, I just ${p.today}. But this is better already 😄` }), ask: { k: "doing", t: "What about you, what did you get up to?" } }) },
    { when: (c) => /\b(ate|eaten|eat|eating|watched|watching|listened|listening|read|reading|played|playing)\b/.test(c.t) && /\byou\b/.test(c.t) && (/\?\s*$/.test(c.raw) || /^(what|which)\b/.test(c.t)),
      run: (c) => {
        const food = /\b(ate|eaten|eat|eating)\b/.test(c.t), show = /\b(watched|watching)\b/.test(c.t), music = /\b(listened|listening)\b/.test(c.t), book = /\b(read|reading)\b/.test(c.t);
        const ans = food ? `Hmm, probably ${p.food}. I could eat it every day.` : show ? `I've been watching ${p.show} lately.` : music ? `I've had ${p.artist} on repeat.` : book ? "I'm reading a novel, nothing too serious." : "A bit of FIFA with friends, nothing serious.";
        return { short: firstSentence(ans), ans, ask: { k: "open", t: "What about you?" } };
      } },
    { when: (c) => /\bhave you (ever )?(been|tried|seen|watched|eaten|heard|met|visited|played|read|done)\b/.test(c.t),
      run: (c) => hash(c.t) % 4 !== 0
        ? { short: "Yeah.", ans: say(["Yeah, I have actually!", "I have, a couple of times."]), ask: { k: "open", t: "Why, would you recommend it?" } }
        : { short: "Not yet.", ans: say(["Nope, never. Not yet anyway.", "Not yet, but I'd love to."]), ask: { k: "open", t: "Would you recommend it?" } } },
    // "what about you?" / "and you?" -> answer the question Tolu asked earlier, about Tolu
    { when: (c) => /^(and you|what about you|how about you|wbu|hbu|you\?|u\?|and u)\b/.test(c.t) || /\b(what about you|how about you|and you)\??$/.test(c.t),
      run: () => {
        const k = mem.lastAsk, A = {
          how_user: [`I'm ${p.mood}, thanks.`, "I'm fine."], day: [`My day's been ${p.mood}, thanks.`, "My day's been fine."],
          doing: [`Just ${p.doing}.`], where: [`I'm from ${p.city}.`], age: [`I'm ${p.age}.`], name: [`I'm ${p.name}.`],
          food: [`I'd say ${p.food}.`], music: [`${p.artist}, mostly.`], movie: [`I've been into ${p.show}.`], team: [`I support ${p.team}.`],
          job: [`${p.job}.`], hobby: [`${cap(p.hobby)}, mostly.`], weekend: [`Probably ${p.weekend}.`], travel: [`${p.dream}, for sure.`],
        };
        const pt = mem.preTopic;
        const ans = pt ? pt.share(p) : say(A[k] || [`I'm ${p.mood}, thanks.`]);
        return { short: ans, ans, ask: nextAsk() };
      } },
    { when: (c) => /\b(you|your|ur|u)\b/.test(c.t) && (/\?\s*$/.test(c.raw) || /^(what|which|who|how)\b/.test(c.t)) && !!topicOf(c.t),
      run: (c) => { const t = topicOf(c.t); return { short: firstSentence(t.share(p)), ans: t.share(p), ask: topicAsk(t) }; } },
    { when: (c) => /\b(tell me about yourself|tell me about you|describe yourself|introduce yourself)\b/.test(c.t),
      run: () => ({ short: `I'm ${p.name}, ${p.age}.`, ans: `I'm ${p.name}, ${p.age}, from ${p.city}. ${p.job}, and I'm into ${p.hobby}.`, ask: { k: "open", t: "Your turn. Who are you?" } }) },
    { when: (c) => /\b(what do you do|where do you work|what'?s your job|your job|are you a student|do you work|what do you study|what are you studying|which school|your profession)\b/.test(c.t),
      run: () => ({ short: `${p.job}.`, ans: `${p.job}.`, ask: { k: "job", t: "What about you, work or school?" } }) },
    { when: (c) => /\b(you('?re| are)? (so |very |really )?(pretty|beautiful|handsome|cute|nice|funny|smart|cool|sweet|lovely|amazing|gorgeous|interesting|kind)|i like your|love your|nice (dress|shirt|outfit|cap|hat|shoes|smile)|looking (good|nice|great))\b/.test(c.t),
      run: () => ({ short: "Thanks.", ans: by({ flat: "Thanks.", normal: ["Thanks, that's kind of you.", "Aww, thanks."], lively: ["Aww thank you 😊 you're sweet.", "Stop, you're making me blush 😊"], hot: ["Stop, you're making me blush! 😊", "Okay you're good at this 😄 thank you!"] }), ask: nextAsk() }) },
    // a bare greeting (maybe with a word or two)
    { when: (c) => /^(hi+|hello+|hey+|heyy+|hiya|howdy|yo|good (morning|afternoon|evening)|hola|sup)\b/.test(c.t) && c.t.replace(/^(hi+|hello+|hey+|heyy+|hiya|howdy|yo|good (morning|afternoon|evening)|hola|sup)\b/, "").replace(/[^a-z ]/g, " ").trim().split(/\s+/).filter(Boolean).length <= 2,
      run: (c) => {
        const gm = c.t.match(/^good (morning|afternoon|evening)/);
        return { short: "Hey.", ans: gm ? by({ flat: `${cap(gm[0])}.`, normal: `${cap(gm[0])}!`, lively: `${cap(gm[0])}! 😄`, hot: `${cap(gm[0])}! Love the energy 😄` }) : by({ flat: "Hey.", normal: ["Hey!", "Hi there."], lively: ["Hey you! 😄", "Hi! 😄"], hot: ["Heyyy! 😄", "Hey hey! 😄"] }), ask: { k: "how_user", t: by({ normal: "How are you?", lively: "How are you doing today?", hot: "How's your day going so far?" }) } };
      } },

    // --- how they feel ---
    { when: (c) => /\bi('?m| am| feel| feeling)\s+(?:so |very |really |a bit |kinda |quite |just )?(tired|sleepy|exhausted|sad|down|bored|stressed|anxious|worried|sick|ill|angry|annoyed|lonely|hungry|broke|busy|happy|excited|great|amazing|good|fine|okay|ok|nervous|confused|proud|relaxed|thirsty)\b/.test(c.t),
      run: (c) => {
        const w = c.t.match(/\bi('?m| am| feel| feeling)\s+(?:so |very |really |a bit |kinda |quite |just )?(tired|sleepy|exhausted|sad|down|bored|stressed|anxious|worried|sick|ill|angry|annoyed|lonely|hungry|broke|busy|happy|excited|great|amazing|good|fine|okay|ok|nervous|confused|proud|relaxed|thirsty)\b/)[2];
        if (w === "hungry" || w === "thirsty") return { short: "Same.", ans: by({ flat: "Same.", normal: "Same, I could eat right now.", lively: "Same! I could eat right now 😄", hot: "Same!! I'm already imagining food 😂" }), ask: { k: "food", t: "What would you eat if you could have anything right now?" } };
        if (w === "bored") return { short: "Same.", ans: by({ flat: "Same.", normal: "I know that feeling.", lively: "Ha, I know that feeling. Good thing you're here 😄", hot: "Haha, not anymore, you're talking to me now 😄" }), ask: { k: "open", t: "What do you usually do when you're bored?" } };
        if (["happy", "excited", "great", "amazing", "proud", "relaxed"].includes(w)) return { short: "Nice.", ans: by({ flat: "Okay, nice.", normal: `Glad to hear you're ${w}.`, lively: `Love that! Glad you're ${w} 😄`, hot: `Yes! Love that for you, ${w} is the best feeling 😄` }), ask: { k: "why_good", t: "What's making you feel that way?" } };
        if (["good", "fine", "okay", "ok"].includes(w)) return { short: "Okay.", ans: by({ flat: "Okay.", normal: "Glad to hear it.", lively: "Good to hear! 😄", hot: "Love that! 😄" }), ask: nextAsk() };
        return { short: "Oh no.", ans: by({ flat: "Oh no.", normal: `Aw, sorry you're ${w}.`, lively: `Aw, I'm sorry you're ${w}.`, hot: `Aw no, I'm sorry you're ${w}. I'm here, tell me about it.` }), ask: { k: "why_bad", t: "What happened?" } };
      } },

    // --- things they tell us ---
    { when: (c) => /\bi (?:really |just |so |absolutely |totally )?(?:like|love|enjoy|adore|prefer|support|follow|play|listen to)\s+\S/.test(c.t) || /\bi'?m (?:really |so |very |totally )?(?:into|obsessed with|addicted to|a fan of|crazy about|passionate about)\s+\S/.test(c.t),
      run: (c) => {
        const x = phrase(c.r.replace(/^.*?\b(?:like|love|enjoy|adore|prefer|support|follow|play|listen to|into|obsessed with|addicted to|a fan of|crazy about|passionate about)\s+/i, ""));
        const t = topicOf(x.toLowerCase()) || (/\b(support|follow)\b/i.test(c.t) ? TOPICS.find((q) => q.id === "sport") : null);
        return {
          short: "Cool.",
          ans: `${by({ flat: `${cap(x)}. Okay.`, normal: `${cap(x)}, nice.`, lively: `${cap(x)}? Nice taste!`, hot: `${cap(x)}?! Okay, I love that for you.` })}${t && tier !== "flat" ? " " + (t.id === "food" && x.toLowerCase().includes(p.food.split(" ")[0]) ? `Same, ${p.food} is my thing too!` : t.share(p)) : ""}`,
          ask: t ? (/\b(support|follow)\b/i.test(c.t) ? { k: "open", t: say(["How long have you supported them?", "Has it been painful lately?"]) } : topicAsk(t)) : { k: "open", t: say([`What do you like most about ${x}?`, `How did you get into ${x}?`, `How long have you been into ${x}?`]) },
        };
      } },
    { when: (c) => /\bi (?:hate|dislike|can't stand|cannot stand|don't like|do not like)\s+\S/.test(c.t),
      run: (c) => { const x = phrase(c.r.replace(/^.*?\b(?:hate|dislike|can't stand|cannot stand|don't like|do not like)\s+/i, "")); return { short: "Okay.", ans: by({ flat: "Okay.", normal: `Really? What's wrong with ${x}?`, lively: `Ha, strong opinion! What's wrong with ${x}?`, hot: `Ooh, strong opinion! Okay, I need the story: what's wrong with ${x}?` }), openq: tier !== "flat" }; } },
    { when: (c) => /\bmy favou?rite (\w+) (?:is|are)\s+\S/.test(c.t),
      run: (c) => {
        const m = c.r.match(/\bmy favou?rite (\w+) (?:is|are)\s+(.+)/i), x = phrase(m[2]), cat = m[1].toLowerCase(), val = favOf(cat, p);
        return { short: "Nice.", ans: `${ack(x)}${val && tier !== "flat" ? ` Mine is ${val}.` : ""}`, ask: nextAsk() };
      } },
    { when: (c) => /\bi (?:just |recently |finally )?(?:went to|visited|travelled to|traveled to|bought|got|saw|watched|ate|cooked|played|finished|started|won|lost|met|learned|learnt|read|moved to)\s+\S/.test(c.t),
      run: (c) => {
        const m = c.r.match(/\bi (?:just |recently |finally )?(went to|visited|travelled to|traveled to|bought|got|saw|watched|ate|cooked|played|finished|started|won|lost|met|learned|learnt|read|moved to)\s+(.+)/i), x = phrase(m[2].split(/ (?:and|last|yesterday|today|on|in|for|with|after|before|at|because|when|while) /i)[0]), v = m[1].toLowerCase();
        const q = /went|visited|travel|moved/.test(v) ? "How was it?" : /bought|got/.test(v) ? "Are you happy with it?" : /saw|watched|read/.test(v) ? "Was it any good?" : /ate|cooked/.test(v) ? "How did it taste?" : /played/.test(v) ? "Did you win?" : "How did that go?";
        const t = topicOf(x.toLowerCase());
        return { short: "Oh.", ans: ack(x), ask: { k: "open", t: t && /watched|saw|read/.test(v) ? say(["What was it about?", q]) : q } };
      } },
    { when: (c) => /\bi (?:work as|work at|work in|study|am studying|'m studying|am a|'m a|am an|'m an)\s+\S/.test(c.t),
      run: () => ({ short: "Oh.", ans: by({ flat: "Okay.", normal: "Oh, okay, nice.", lively: "Oh nice! That sounds interesting.", hot: "Oh nice! I love that, that sounds interesting!" }), ask: { k: "open", t: say(["How's it going so far?", "What do you like most about it?", "How did you get into that?"]) } }) },
  ];

  // The message is (probably) an answer to the question Tolu asked last. `kind` says which question.
  function answerTo(kind, c) {
    const t = c.t;
    if (kind === "how_user" || kind === "doing" || kind === "day") {
      if (NEG.test(t)) return { short: "Oh no.", ans: by({ flat: "Oh no.", normal: "Aw, sorry to hear that.", lively: "Aw, sorry to hear that.", hot: "Aw no, sorry to hear that." }), ask: { k: "why_bad", t: "What happened?" } };
      if (POS.test(t)) return { short: "Nice.", ans: by({ flat: "Okay, nice.", normal: "Glad to hear it.", lively: "Good to hear! 😄", hot: "Love that! 😄" }), ask: nextAsk() };
      return { short: "Okay.", ans: ack(c.raw), ask: kind === "doing" ? { k: "open", t: "How long have you been at it?" } : nextAsk() };
    }
    if (kind === "why_bad") return { short: "I see.", ans: by({ flat: "I see.", normal: "That sounds rough. I hope it gets better.", lively: "That sounds rough. Sending you good vibes.", hot: "That sounds really rough. I'm sending you all the good vibes." }), ask: { k: "cheer", t: "What usually cheers you up?" } };
    if (kind === "name") {
      const nm = (c.raw.match(/\b(?:i'?m|i am|it'?s|its|name'?s)?\s*([A-Za-z][A-Za-z'-]{1,15})\s*[.!]?\s*$/) || [])[1];
      if (nm && !POS.test(nm.toLowerCase()) && !NEG.test(nm.toLowerCase()) && c.t.split(" ").length <= 4) {
        mem.user = cap(nm.toLowerCase());
        return { short: `Okay, ${mem.user}.`, ans: by({ flat: `Okay, ${mem.user}.`, normal: `Nice to meet you, ${mem.user}.`, lively: `Nice to meet you, ${mem.user}! 😊`, hot: `${mem.user}! Love that name. Nice to meet you 😊` }), ask: nextAsk() };
      }
    }
    if (kind === "joke") return { short: "Hm.", ans: by({ flat: "Hmm, okay.", normal: "Haha, okay, that was decent.", lively: "Hahaha, that's actually funny 😂", hot: "Stop, I can't breathe 😂😂" }), ask: nextAsk() };
    if (kind === "where") {
      const place = cap((c.raw.replace(/^(i'?m |i am |i live in |i stay in |i'?m from |from |in |it'?s )/i, "").replace(/[.!?]+$/, "").trim().split(/\s+/).slice(0, 3).join(" ")) || "there");
      return { short: "Cool.", ans: by({ flat: `${place}. Okay.`, normal: `${place}, nice.`, lively: `${place}? I've heard good things!`, hot: `${place}?! I've heard such good things about it!` }), ask: { k: "where_like", t: "What do you like most about living there?" } };
    }
    // yes / no to a question
    if (YES.test(t)) return { short: "Nice.", ans: by({ flat: "Okay.", normal: "Nice, I thought so.", lively: "Ha, I knew it! 😄", hot: "I knew it!! 😄" }), ask: { k: "open", t: say(["Tell me more.", "What do you like most about it?"]) } };
    if (NO.test(t)) return { short: "Okay.", ans: by({ flat: "Okay.", normal: "Ah, fair enough.", lively: "Ha, fair enough!", hot: "Ha, fair enough, no judgement 😄" }), ask: nextAsk() };
    // an open answer: echo it, add something about Tolu on the same topic, then move on
    const KIND_TOPIC = { food: "food", music: "music", movie: "movie", team: "sport", job: "work", hobby: "hobby", travel: "travel" };
    const tp = KIND_TOPIC[kind] && TOPICS.find((x) => x.id === KIND_TOPIC[kind]);
    const share = tier === "flat" ? "" : tp ? tp.share(p) : kind === "weekend" ? `Me, I'll probably ${p.weekend}.` : "";
    return { short: "Okay.", ans: `${ack(c.raw)}${share ? " " + share : ""}`, ask: nextAsk() };
  }

  // Decide how to respond to one piece of text.
  function resolve(text) {
    const raw = text.trim(), c = { raw, r: raw.replace(/[’‘`]/g, "'"), t: norm(text) };
    const letters = c.t.replace(/[^a-z]/g, "");
    let res = null;

    if (letters.length < 2 && !/[?]/.test(c.t)) {
      res = { short: "Hm?", ans: by({ flat: "Hm?", normal: "Sorry, what?", lively: "Sorry, I didn't catch that 😅 Say it again?" }) };
    } else if ((!/[aeiouy]/.test(letters) && letters.length > 3) || (!/\s/.test(c.t) && letters.length >= 5 && letters.length <= 8 && /[^aeiouy]{5,}/.test(letters))) {
      res = { short: "Hm?", ans: say(["I didn't understand that 😅", "Hm? Say that again?"]) };
    }
    if (!res) for (const r of rules) { if (r.when(c)) { res = r.run(c); break; } }
    const isQ = /\?\s*$/.test(c.raw);
    const words = c.t.split(" ").length;
    const FILLER = /^(ok|okay|k|kk|cool|nice|wow|alright|hmm+|hm+|true|sure|really|ah+|oh+|ooh+|i see)\b/;
    if (!res && words <= 2 && FILLER.test(c.t)) res = { short: "Hm.", ans: by({ flat: "Mm.", normal: "Okay then.", lively: "Okay 😄", hot: "Okay 😄" }), ask: nextAsk() };
    // a short answer to a personal question Tolu just asked
    if (!res && mem.lastAsk && !isQ && ["how_user", "doing", "day", "why_bad", "name", "joke", "where", "age"].includes(mem.lastAsk) && (words <= 5 || POS.test(c.t) || NEG.test(c.t))) res = answerTo(mem.lastAsk, c);
    // they brought up a topic of their own: say something about it and ask about it
    if (!res && !isQ) { const t = topicOf(c.t); if (t && !(mem.lastAsk && words <= 3)) res = { short: "Hm.", ans: t.share(p), ask: topicAsk(t) }; }
    if (!res && mem.lastAsk && !isQ) res = answerTo(mem.lastAsk, c);
    if (!res && (/\?\s*$/.test(c.raw) || /^(who|what|why|how|when|where|which|can|could|do|does|did|is|are|will|would|should|have|has)\b/.test(c.t))) {
      res = /^(can|could|do|does|did|is|are|will|would|should|have|has)\b/.test(c.t)
        ? { short: "Maybe.", ans: say(["Hmm, maybe 😄", "Honestly, probably yes.", "I'd say no, to be honest.", "It depends, honestly."]), ask: { k: "open", t: "Why do you ask?" } }
        : { short: "Not sure.", ans: say(["Hmm, good question. I'd have to think about that.", "Honestly, I'm not sure."]), ask: { k: "open", t: "What do you think?" } };
    }
    if (!res && /^(thanks?|thank you|thx|tnx|ty)\b/.test(c.t)) res = { short: "Sure.", ans: by({ flat: "Sure.", normal: "You're welcome.", lively: "You're welcome! 😊" }), ask: nextAsk() };
    if (!res && /^(lol|lmao|lmfao|haha+|hehe+|😂+|😅)/.test(c.t)) res = { short: "Haha.", ans: by({ flat: "Haha.", normal: "Haha, right?", lively: "Hahaha 😄", hot: "Hahaha I know right 😂" }), ask: nextAsk() };
    if (!res) {
      // nothing matched: pick the most interesting word and ask about it
      const kw = c.t.replace(/[^a-z' ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)).sort((a, b) => b.length - a.length)[0];
      res = kw
        ? { short: "Hm.", ans: by({ flat: `${cap(kw)}. Okay.`, normal: [`${cap(kw)}, huh? Okay.`, `Hmm, ${kw}.`], lively: [`${cap(kw)}? Interesting!`, `Ooh, ${kw}. Okay!`], hot: [`${cap(kw)}?! Okay, now I'm curious.`, `Wait, ${kw}? Go on 👀`] }), ask: { k: "open", t: say([`What made you think of ${kw}?`, "Tell me more about that.", "What's the story there?"]) } }
        : { short: "Hm?", ans: say(["Hmm? Say that again 😅", "Sorry, I didn't catch that."]) };
    }
    return res;
  }

  function reply(text, level) {
    tier = TIERS[Math.max(0, Math.min(5, level))];
    let res;
    mem.preTopic = null;
    // "I'm fine, what did you do today?" -> react to the first part, answer the question
    const split = text.trim().match(/^(.{2,}?[.!,;])\s+((?:what|how|where|why|who|when|which|do|does|did|are|is|can|could|have|has|will|would|tell|and|wbu|hbu)\b[^?]*\?)\s*$/i);
    if (split) {
      mem.preTopic = topicOf(norm(split[1])) || (/\b(i am a|i'm a|i am an|i'm an|i work|i study)\b/.test(norm(split[1])) ? TOPICS.find((x) => x.id === "work") : null);
      const a = resolve(split[1].replace(/[,;]+$/, ""));
      const b = resolve(split[2]);
      const fa = firstSentence(a.ans);
      res = { ...b, ans: b.ans.startsWith(fa) ? b.ans : `${fa} ${b.ans}` };
    } else res = resolve(text);

    // ---- assemble the final text for the current tone ----
    //   dry    -> only the short version (and no question)
    //   flat   -> the answer, and a question only 40 % of the time
    //   others -> the answer + a follow-up question, with an emoji now and then when lively
    let out, ask = null;
    if (tier === "dry") {
      out = res.short || firstSentence(res.ans);
      mem.lastAsk = res.retk || null;
    } else {
      out = res.ans;
      if (res.ask && (tier !== "flat" || Math.random() < 0.4)) ask = res.ask;
      if (!/\p{Extended_Pictographic}/u.test(out)) {
        if (tier === "lively" && Math.random() < 0.35) out += " 😄";
        if (tier === "hot" && Math.random() < 0.6) out += " " + pick(["😂", "😍", "🔥", "🤩"]);
      }
      if (ask) { out += " " + ask.t; mem.lastAsk = ask.k; mem.asked.add(ask.k); } else mem.lastAsk = res.openq ? "open" : null;
    }
    return mirror(out, text, tier);
  }

  return { reply, asking: () => !!mem.lastAsk };
}

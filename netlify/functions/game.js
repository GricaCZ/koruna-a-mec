const recentRequests = new Map();

const MAP_KEYS = new Set([
  "cerny_brod","hrad_valdorie","borovy_les","stary_mlyn","kralovske_mesto",
  "stribrna_ves","klaster_otmara","vrani_tvrz","jezerni_pristav","horsky_prusmyk"
]);

const RANDOM_EVENTS = [
  "Na cestě se objeví unavený posel, který něco hledá.",
  "Počasí se náhle zhorší a cesta se stane obtížnější.",
  "Poblíž je slyšet hádka mezi dvěma pocestnými.",
  "Hráč narazí na opuštěný vůz a musí se rozhodnout, zda ho prozkoumá.",
  "Místní hlídka se vyptává na dění v okolí.",
  "Pocestný obchodník nabízí informaci výměnou za drobnou laskavost."
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function text(v, max = 200) {
  return String(v ?? "").trim().slice(0, max);
}

function basicRateLimit(event) {
  const ip = String(
    event.headers?.["x-nf-client-connection-ip"] ||
    event.headers?.["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  const now = Date.now();
  const windowMs = 60_000;
  const max = 20;
  const arr = (recentRequests.get(ip) || []).filter(t => now - t < windowMs);

  if (arr.length >= max) return false;
  arr.push(now);
  recentRequests.set(ip, arr);

  if (recentRequests.size > 500) {
    for (const [key, times] of recentRequests) {
      if (!times.some(t => now - t < windowMs)) recentRequests.delete(key);
    }
  }
  return true;
}

function sanitizeInventory(value, fallback) {
  const arr = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []);
  return arr.map(x => text(x, 60)).filter(Boolean).slice(0, 40);
}

function sanitizeQuests(value, fallback) {
  const arr = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []);
  const ids = new Set();
  const out = [];

  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const id = text(raw.id, 50).replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!id || ids.has(id)) continue;
    ids.add(id);

    out.push({
      id,
      title: text(raw.title || "Úkol", 100),
      description: text(raw.description, 220),
      status: raw.status === "done" ? "done" : "active",
      rewardGold: clamp(Math.floor(num(raw.rewardGold, 0)), 0, 40),
      rewardXp: clamp(Math.floor(num(raw.rewardXp, 0)), 0, 60)
    });

    if (out.length >= 12) break;
  }
  return out;
}

function sanitizeNpcMemory(value, fallback) {
  const oldData =
    fallback && typeof fallback === "object"
      ? fallback
      : {};

  const newData =
    value && typeof value === "object"
      ? value
      : {};

  const source = {
    ...oldData,
    ...newData
  };

  const out = {};
  let count = 0;

  for (const [rawName, rawValue] of Object.entries(source)) {
    if (count >= 12) break;

    const name = text(rawName, 60);
    if (!name) continue;

    const previous =
      oldData[rawName] && typeof oldData[rawName] === "object"
        ? oldData[rawName]
        : {};

    if (rawValue && typeof rawValue === "object") {
      out[name] = {
        relationship: clamp(
          Math.floor(
            num(rawValue.relationship, previous.relationship || 0)
          ),
          -5,
          5
        ),
        note: text(
          rawValue.note ||
          rawValue.notes ||
          previous.note ||
          previous.notes,
          180
        ),
        lastSeen: text(
          rawValue.lastSeen ||
          previous.lastSeen,
          80
        )
      };
    } else {
      out[name] = {
        relationship: 0,
        note: text(rawValue, 180),
        lastSeen: ""
      };
    }

    count++;
  }

  return out;
}

function sanitizeFactions(aiValue, oldValue) {
  const old = oldValue && typeof oldValue === "object" ? oldValue : {};
  const ai = aiValue && typeof aiValue === "object" ? aiValue : {};
  const out = {};

  for (const key of ["koruna","mestane","venkov","podsveti"]) {
    const before = clamp(Math.floor(num(old[key], 0)), -100, 100);
    const proposed = clamp(Math.floor(num(ai[key], before)), -100, 100);
    out[key] = clamp(proposed, before - 3, before + 3);
  }

  return out;
}

function sanitizeDiscovered(value, fallback) {
  const arr = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []);
  const out = [];

  for (const k of arr) {
    const key = text(k, 40);
    if (MAP_KEYS.has(key) && !out.includes(key)) out.push(key);
  }

  if (!out.includes("cerny_brod")) out.unshift("cerny_brod");
  return out;
}

function sanitizeCombat(value) {
  if (!value || typeof value !== "object") return null;

  const enemy = text(value.enemy, 70);
  if (!enemy) return null;

  const difficulty = clamp(Math.floor(num(value.difficulty, 1)), 1, 5);
  const maxHp = clamp(
    Math.floor(num(value.enemyMaxHp, value.enemyHp || 30)),
    10,
    120
  );

  const hp = clamp(Math.floor(num(value.enemyHp, maxHp)), 0, maxHp);

  if (hp <= 0) return null;

  return {
    enemy,
    enemyHp: hp,
    enemyMaxHp: maxHp,
    difficulty
  };
}

function attackIntent(action) {
  return /(zaúto|útoč|udeř|sekn|střel|bodn|vrhnu se|bojuju|bojuji)/i.test(action);
}

function weaponBonus(name) {
  const t = String(name || "").toLowerCase();

  if (/rytířský meč|železný meč/.test(t)) return 3;
  if (/luk/.test(t)) return 2;
  if (/dýka|nůž|rezavý meč/.test(t)) return 1;

  return 0;
}

function armorBonus(name) {
  const t = String(name || "").toLowerCase();

  if (/řetízková košile|brnění/.test(t)) return 3;
  if (/kožená zbroj/.test(t)) return 2;
  if (/plášť/.test(t)) return 1;

  return 0;
}

function deterministicRoll(turn, action, mod) {
  let h = Math.floor(num(turn, 0)) * 17 + String(action).length * 13;

  for (let i = 0; i < String(action).length; i++) {
    h = (h * 31 + String(action).charCodeAt(i)) >>> 0;
  }

  return h % mod;
}

function resolveCombat(old, proposed, action) {
  const existing = sanitizeCombat(old.combat);
  let combat = existing || sanitizeCombat(proposed);

  let hp = clamp(
    Math.floor(num(old.hp, 100)),
    0,
    Math.max(1, Math.floor(num(old.maxHp, 100)))
  );

  let bonusXp = 0;
  let note = "";

  if (!existing) {
    return { combat, hp, bonusXp, note };
  }

  if (!attackIntent(action)) {
    return {
      combat: sanitizeCombat(proposed),
      hp,
      bonusXp,
      note
    };
  }

  combat = existing;

  const roll = deterministicRoll(old.turn, action, 4);

  const playerDamage = clamp(
    3 +
    Math.floor(num(old.strength, 5) / 2) +
    weaponBonus(old.equipment?.weapon) +
    roll,
    3,
    22
  );

  combat.enemyHp = Math.max(0, combat.enemyHp - playerDamage);

  if (combat.enemyHp <= 0) {
    bonusXp = 12 + combat.difficulty * 6;

    note =
      `\n\n[Herní pravidla: protivník ztratil ${playerDamage} výdrže a střet skončil. +${bonusXp} XP.]`;

    combat = null;

    return {
      combat,
      hp,
      bonusXp,
      note
    };
  }

  const enemyRoll = deterministicRoll(old.turn + 1, action, 3);

  const incoming = Math.max(
    1,
    combat.difficulty * 2 +
    enemyRoll -
    armorBonus(old.equipment?.armor)
  );

  hp = Math.max(0, hp - incoming);

  if (hp <= 0) {
    hp = 1;
    combat = null;

    note =
      `\n\n[Herní pravidla: způsobil jsi ${playerDamage} ztráty výdrže. Postava byla v tomto střetu poražena a zůstává na 1 životě.]`;
  } else {
    note =
      `\n\n[Herní pravidla: protivník ztratil ${playerDamage} výdrže, tvoje postava ${incoming} životů.]`;
  }

  return {
    combat,
    hp,
    bonusXp,
    note
  };
}

function compactState(old) {
  return {
    name: text(old.name, 24),
    job: text(old.job, 30),
    gender: text(old.gender, 10),
    place: text(old.place, 80),

    hp: num(old.hp, 100),
    maxHp: num(old.maxHp, 100),

    strength: num(old.strength, 5),
    intelligence: num(old.intelligence, 5),
    charisma: num(old.charisma, 5),

    gold: num(old.gold, 0),

    factions: old.factions || {},

    inventory: sanitizeInventory(old.inventory, []),

    equipment: old.equipment || {},

    quests: sanitizeQuests(old.quests, []),

    discovered: sanitizeDiscovered(old.discovered, []),

    npcMemory: sanitizeNpcMemory(old.npcMemory, {}),

    worldFlags: old.worldFlags || {},

    combat: sanitizeCombat(old.combat),

    summary: text(old.summary, 900),
    story: text(old.story, 1600),

    turn: Math.floor(num(old.turn, 0))
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Použij POST."
    });
  }

  if (!basicRateLimit(event)) {
    return json(429, {
      error: "Příliš mnoho tahů během krátké chvíle. Zkus to za minutu."
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return json(500, {
        error: "Chybí OPENAI_API_KEY."
      });
    }

    const body = JSON.parse(event.body || "{}");

    const action = text(body.action, 600);

    const old =
      body.state && typeof body.state === "object"
        ? body.state
        : {};

    if (!action) {
      return json(400, {
        error: "Chybí akce hráče."
      });
    }

    const turn = Math.max(
      0,
      Math.floor(num(old.turn, 0))
    );

    const randomEvent =
      !old.combat &&
      turn > 0 &&
      turn % 5 === 0
        ? RANDOM_EVENTS[turn % RANDOM_EVENTS.length]
        : "";

    const prompt = `
Jsi český AI vypravěč ne-grafického středověkého RPG Koruna a Meč.

Vrať POUZE platný JSON v tomto tvaru:
{
  "story": "pokračování příběhu",
  "place": "aktuální místo",
  "hp": 100,
  "inventory": [],
  "quests": [
    {
      "id": "unikatni_id",
      "title": "název úkolu",
      "description": "co má hráč udělat",
      "status": "active",
      "rewardGold": 0,
      "rewardXp": 0
    }
  ],
  "discovered": [],
  "npcMemory": {
    "Jméno NPC": {
      "relationship": 0,
      "note": "krátká důležitá vzpomínka",
      "lastSeen": "místo"
    }
  },
  "factions": {
    "koruna": 0,
    "mestane": 0,
    "venkov": 0,
    "podsveti": 0
  },
  "worldFlags": {},
  "combat": null,
  "summary": "stručné shrnutí důležitých událostí"
}

Pravidla:
- Piš česky a zachovej návaznost.
- Respektuj pohlaví a povolání postavy; nikdy je svévolně neměň.
- Nikdy nerozhoduj za hráče. Popiš důsledek a nech prostor pro další rozhodnutí.
- Dobrodružství může mít napětí a souboje, ale bez grafických detailů.
- Nevytvářej explicitní sexuální obsah ani detailní sebepoškozování.
- Groše, XP, úroveň, základní statistiky a nasazenou výbavu neřídíš ty; hlídá je hra.
- Inventář změň jen tehdy, když hráč předmět skutečně získá, použije, ztratí nebo odevzdá.
- Úkol vytvářej jen tehdy, když vznikl přirozeně v příběhu.
- status úkolu může být jen "active" nebo "done".
- Úkol označ "done" pouze po skutečném splnění.
- Odměny úkolů drž rozumné; server je stejně omezuje.
- NPC paměť používej pouze pro důležité pojmenované postavy. relationship je od -5 do +5.
- Pověst frakcí měň jen po významném rozhodnutí a maximálně o pár bodů.
- combat je null mimo střet. Při novém střetu použij objekt:
  {"enemy":"název protivníka","enemyHp":30,"enemyMaxHp":30,"difficulty":1}
- Během již probíhajícího střetu nerozhoduj číselné poškození; to dopočítá server.
- summary udržuj krátké, věcné a jen s informacemi důležitými do budoucna.
${randomEvent ? `- Do tohoto tahu můžeš přirozeně zapojit náhodnou událost: ${randomEvent}` : ""}

AKTUÁLNÍ STAV:
${JSON.stringify(compactState(old))}

AKCE HRÁČE:
${action}
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: prompt
        })
      }
    );

    const raw = await response.json();

    if (!response.ok) {
      return json(response.status, {
        error:
          raw?.error?.message ||
          "Chyba OpenAI API."
      });
    }

    let output = raw.output_text || "";

    if (!output && Array.isArray(raw.output)) {
      for (const item of raw.output) {
        if (!Array.isArray(item.content)) continue;

        for (const part of item.content) {
          if (
            part &&
            typeof part.text === "string"
          ) {
            output = part.text;
            break;
          }
        }

        if (output) break;
      }
    }

    output = output
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    let ai;

    try {
      ai = JSON.parse(output);
    } catch {
      const start = output.indexOf("{");
      const end = output.lastIndexOf("}");

      if (start < 0 || end <= start) {
        throw new Error(
          "AI nevrátila platná herní data."
        );
      }

      ai = JSON.parse(
        output.slice(start, end + 1)
      );
    }

    const oldQuests =
      sanitizeQuests(old.quests, []);

    const aiQuests =
  sanitizeQuests(ai.quests, []);

const aiQuestById =
  Object.fromEntries(
    aiQuests.map(q => [q.id, q])
  );

const newQuests =
  oldQuests.map(oldQuest => {
    const updated =
      aiQuestById[oldQuest.id];

    if (!updated) {
      return oldQuest;
    }

    return {
      ...oldQuest,
      ...updated,

      // U existujícího úkolu AI nesmí změnit odměnu.
      rewardGold: oldQuest.rewardGold,
      rewardXp: oldQuest.rewardXp
    };
  });

for (const q of aiQuests) {
  if (!oldQuests.some(oldQuest => oldQuest.id === q.id)) {
    newQuests.push(q);
  }
}

    const oldQuestById =
      Object.fromEntries(
        oldQuests.map(q => [q.id, q])
      );

    const claimedRewards = {
      ...(
        (
          old.worldFlags &&
          old.worldFlags.claimedQuestRewards
        ) || {}
      )
    };

    let questGoldReward = 0;
    let questXpReward = 0;

    for (const q of newQuests) {
      const previous =
        oldQuestById[q.id];

      if (
        previous &&
        previous.status !== "done" &&
        q.status === "done" &&
        !claimedRewards[q.id]
      ) {
        questGoldReward += q.rewardGold;
        questXpReward += q.rewardXp;

        claimedRewards[q.id] = true;
      }
    }

    const maxHp = Math.max(
      1,
      Math.floor(num(old.maxHp, 100))
    );

    const proposedHp = clamp(
      Math.floor(num(ai.hp, old.hp)),
      0,
      maxHp
    );

    let hp = clamp(
      proposedHp,
      Math.max(
        0,
        num(old.hp, maxHp) - 15
      ),
      Math.min(
        maxHp,
        num(old.hp, maxHp) + 15
      )
    );

    const combatResult =
      resolveCombat(
        old,
        ai.combat,
        action
      );

    if (old.combat) {
      hp = combatResult.hp;
    }

    const factions =
      sanitizeFactions(
        ai.factions,
        old.factions
      );

    const npcMemory =
      sanitizeNpcMemory(
        ai.npcMemory,
        old.npcMemory
      );

    const discovered =
      sanitizeDiscovered(
        ai.discovered,
        old.discovered
      );

    const inventory =
      sanitizeInventory(
        ai.inventory,
        old.inventory
      );

    const worldFlags = {
      ...(
        old.worldFlags &&
        typeof old.worldFlags === "object"
          ? old.worldFlags
          : {}
      ),

      ...(
        ai.worldFlags &&
        typeof ai.worldFlags === "object"
          ? ai.worldFlags
          : {}
      ),

      claimedQuestRewards:
        claimedRewards
    };

    const result = {
      ...old,

      version: 6,

      name:
        old.name ||
        "Hrdina",

      job:
        old.job ||
        "Poutník",

      gender:
        old.gender ||
        "Muž",

      place: text(
        ai.place ||
        old.place ||
        "Neznámé místo",
        80
      ),

      story:
        text(
          ai.story ||
          "Příběh pokračuje.",
          3500
        ) +
        combatResult.note,

      summary: text(
        ai.summary ||
        old.summary,
        900
      ),

      hp,
      maxHp,

      strength: clamp(
        Math.floor(
          num(old.strength, 5)
        ),
        1,
        30
      ),

      intelligence: clamp(
        Math.floor(
          num(old.intelligence, 5)
        ),
        1,
        30
      ),

      charisma: clamp(
        Math.floor(
          num(old.charisma, 5)
        ),
        1,
        30
      ),

      spentLevelPoints:
        Math.max(
          0,
          Math.floor(
            num(
              old.spentLevelPoints,
              0
            )
          )
        ),

      equipment:
        old.equipment &&
        typeof old.equipment === "object"
          ? old.equipment
          : {
              weapon: "",
              armor: ""
            },

      inventory,
      quests: newQuests,

      gold: Math.max(
        0,
        Math.floor(
          num(old.gold, 0)
        ) +
        questGoldReward
      ),

      xp: Math.max(
        0,
        Math.floor(
          num(old.xp, 0)
        ) +
        questXpReward +
        combatResult.bonusXp
      ),

      factions,
      npcMemory,
      discovered,
      worldFlags,

      combat:
        combatResult.combat,

      turn:
        turn + 1
    };

    result.level = Math.max(
      1,
      Math.floor(
        result.xp / 100
      ) + 1
    );

    return json(
      200,
      result
    );

  } catch (error) {
    return json(
      500,
      {
        error:
          "Nepodařilo se zpracovat tah hry.",

        detail:
          error.message
      }
    );
  }
};

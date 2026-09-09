exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Použij POST." })
    };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Chybí OPENAI_API_KEY." })
      };
    }

    const body = JSON.parse(event.body || "{}");
    const action = String(body.action || "").trim();
    const old = body.state || {};

    if (!action) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Chybí akce hráče." })
      };
    }

    const prompt = `
Jsi český AI vypravěč středověkého RPG Koruna a Meč.

Vrať pouze platný JSON:
{
  "story": "pokračování příběhu",
  "place": "aktuální místo",
  "hp": 100,
  "maxHp": 100,
  "xp": 0,
  "strength": 5,
  "intelligence": 5,
  "charisma": 5,
  "gold": 0,
  "reputation": 0,
  "inventory": [],
  "equipment": {"weapon":"","armor":""},
  "quests": [],
  "discovered": [],
  "npcMemory": {},
  "worldFlags": {},
  "combat": null,
  "summary": "stručné shrnutí",
  "turn": 1
}

Pravidla:
- Piš česky.
- Zachovej návaznost příběhu.
- Hráč může dělat vlastní rozhodnutí.
- Neměň inventář, groše ani statistiky bez důvodu.
- NPC si mohou pamatovat důležité události.
- Bez grafického násilí.

PŘEDCHOZÍ STAV:
${JSON.stringify(old)}

AKCE HRÁČE:
${action}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: prompt
      })
    });

    const raw = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: raw?.error?.message || "Chyba OpenAI API."
        })
      };
    }

    let text = raw.output_text || "";

    if (!text && Array.isArray(raw.output)) {
      for (const item of raw.output) {
        if (!Array.isArray(item.content)) continue;
        for (const part of item.content) {
          if (part && typeof part.text === "string") {
            text = part.text;
            break;
          }
        }
        if (text) break;
      }
    }

    text = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    const ai = JSON.parse(text);

    const result = {
      ...old,
      ...ai,
      name: old.name || ai.name || "Hrdina",
      job: old.job || ai.job || "Poutník",
      turn: Number(old.turn || 0) + 1 
           };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "Nepodařilo se zpracovat tah hry.",
        detail: error.message
      })
    };
  }
}; 

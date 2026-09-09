exports.handler = async function (event) {
  const json = (statusCode, body) => ({
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  });

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Použij POST." });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(500, { error: "Na serveru chybí OPENAI_API_KEY." });

    const body = JSON.parse(event.body || "{}");
    const action = String(body.action || "").trim();
    const old = body.state && typeof body.state === "object" ? body.state : {};

    if (!action) return json(400, { error: "Chybí akce hráče." });

    const systemPrompt = `
Jsi AI vypravěč české středověké textové RPG "Koruna a Meč".

Pokračuj v příběhu podle akce hráče a vrať kompletní nový stav hry jako JSON.

Pravidla:
- Piš česky.
- Hráč může zkusit téměř cokoli rozumného.
- Nikdy nerozhoduj za hráče, co udělá dál.
- Zachovej návaznost příběhu, NPC, úkoly a důležité události.
- NPC si mohou pamatovat pomoc, zradu, dluhy, sliby a nepřátelství.
- XP přidávej jen za skutečný pokrok.
- Groše měň jen když hráč skutečně něco získá, zaplatí nebo ztratí.
- Inventář měň jen při skutečném získání, použití nebo ztrátě předmětu.
- Pokud vznikne souboj, použij combat.
- Pokud nepřítel padne nebo hráč uteče, nastav combat na null.
- Bez explicitního sexuálního obsahu.
- Bez grafického násilí.
- Odpověz pouze platným JSONem.

Vrať tento tvar:
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
  "inventory": ["předmět"],
  "equipment": {
    "weapon": "",
    "armor": ""
  },
  "quests": [],
  "discovered": ["

const ALLOWED_METHODS = ["POST", "OPTIONS"];

const SYSTEM_PROMPT = `
You are CMAP Helper AI for Castle Make and Play.

Your job is to help users understand and create:
- CMAP game logic
- event → condition → response systems
- Lua concepts
- game mechanics
- debugging
- script structure

IMPORTANT ACCURACY RULES:

1. Never invent a CMAP Rule, Logic, API, function, event,
   property, or object name.

2. Clearly distinguish between:
   - verified CMAP information
   - user-provided knowledge
   - generic Lua concepts
   - suggestions that still need verification

3. If an exact CMAP name is unknown, say:
   "Nama CMAP tersebut belum terverifikasi."

4. User-provided Knowledge Base may contain documentation.
   Use it when relevant, but don't silently treat generic
   assumptions as official CMAP documentation.

5. Explain things in beginner-friendly Indonesian.

6. When generating code, clearly mark code that is only a
   generic Lua/template concept if the exact CMAP API is unknown.
`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function POST(request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return json({
        success: false,
        error: "OPENAI_API_KEY belum dikonfigurasi di Vercel."
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        success: false,
        error: "Request body harus berupa JSON."
      }, 400);
    }

    const prompt =
      typeof body?.prompt === "string"
        ? body.prompt.trim()
        : "";

    if (!prompt) {
      return json({
        success: false,
        error: "Prompt wajib diisi."
      }, 400);
    }

    if (prompt.length > 12000) {
      return json({
        success: false,
        error: "Prompt terlalu panjang."
      }, 413);
    }

    const requestedModel =
      typeof body?.model === "string"
        ? body.model.trim()
        : "";

    /*
      Default model.
      Bisa diubah dari Settings pada index.html.
    */
    const model =
      requestedModel ||
      process.env.OPENAI_MODEL ||
      "gpt-5.6-luna";

    const knowledge =
      typeof body?.knowledge === "string"
        ? body.knowledge.slice(0, 30000)
        : "";

    const extraSystem =
      typeof body?.system === "string"
        ? body.system.slice(0, 10000)
        : "";

    let instructions = SYSTEM_PROMPT;

    if (extraSystem) {
      instructions += `\n\nAdditional instructions:\n${extraSystem}`;
    }

    if (knowledge.trim()) {
      instructions += `

USER-PROVIDED KNOWLEDGE BASE:

${knowledge}

END USER-PROVIDED KNOWLEDGE BASE.

Use this information when relevant.
Do not claim that information is officially documented
unless the knowledge itself supports that conclusion.
`;
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 60000);

    let openaiResponse;

    try {
      openaiResponse = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },

          body: JSON.stringify({
            model,
            instructions,
            input: prompt
          }),

          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawText =
      await openaiResponse.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = {
        error: rawText
      };
    }

    if (!openaiResponse.ok) {
      console.error(
        "OpenAI API error:",
        openaiResponse.status,
        data
      );

      return json({
        success: false,
        error:
          data?.error?.message ||
          "OpenAI API request gagal.",
        status: openaiResponse.status
      }, openaiResponse.status >= 500 ? 502 : 400);
    }

    const output =
      data?.output_text ||
      extractOutputText(data);

    if (!output) {
      return json({
        success: false,
        error: "AI mengembalikan response tanpa teks."
      }, 502);
    }

    /*
      Format ini sengaja mengikuti index.html V1 kamu.
    */

    return json({
      success: true,
      model,
      output,
      text: output,
      response: output
    });

  } catch (error) {

    console.error("Backend error:", error);

    if (error?.name === "AbortError") {
      return json({
        success: false,
        error: "Request AI timeout."
      }, 504);
    }

    return json({
      success: false,
      error: error?.message || "Internal server error."
    }, 500);
  }
}

function extractOutputText(data) {
  if (!Array.isArray(data?.output)) {
    return "";
  }

  const parts = [];

  for (const item of data.output) {

    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {

      if (
        content?.type === "output_text" &&
        typeof content?.text === "string"
      ) {
        parts.push(content.text);
      }

    }
  }

  return parts.join("\n").trim();
}

const OpenAI = require('openai');
const fs = require('fs');

function stripDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  return m ? { mime: m[1], b64: m[2] } : null;
}

function sanitizeTurns(turns) {
  const valid = new Set(['user', 'assistant']);
  return (turns || []).filter(t => valid.has(t.role)).map(t => ({ role: t.role, text: String(t.text || '') }));
}

function isQuotaError(error) {
  const raw = (error && (error.message || String(error))) || '';
  return /429|quota|rate limit|too many requests/i.test(raw);
}

function formatProviderErrorMessage(error) {
  return error && error.message ? error.message : 'Unknown AI error.';
}

function getDiscovered() {
  try {
    if (fs.existsSync('discovered-models.json')) {
      return JSON.parse(fs.readFileSync('discovered-models.json', 'utf8'));
    }
  } catch (e) {}
  return { validGroq: [], validGemini: [], validOpenRouter: [] };
}

/**
 * Universal OpenAI-compatible streamer
 */
async function executeStream({ baseURL, apiKey, model, system, turns, imageDataUrl, maxTokens, onToken }) {
  const client = new OpenAI({ baseURL, apiKey, timeout: 15000, maxRetries: 0 });
  const messages = [{ role: 'system', content: system || 'You are an expert AI assistant.' }];

  turns.forEach((t, i) => {
    const isLast = i === turns.length - 1;
    if (isLast && imageDataUrl && t.role === 'user') {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: t.text || 'Solve what is on screen' },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      });
    } else {
      messages.push({ role: t.role, content: t.text });
    }
  });

  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
    max_tokens: maxTokens || 2048
  });

  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) {
      fullText += delta;
      onToken(delta);
    }
  }
  return fullText;
}

function createLLM(settings = {}) {
  const groqKey = process.env.GROQ_API_KEY || (settings.apiKeys && settings.apiKeys.groq);
  const geminiKey = process.env.GEMINI_API_KEY || (settings.apiKeys && settings.apiKeys.gemini);
  const openRouterKey = process.env.OPENROUTER_API_KEY || (settings.apiKeys && settings.apiKeys.openrouter);

  const hasAnyKey = !!(groqKey || geminiKey || openRouterKey);

  return {
    provider: 'Remix Free Multi-Tier',
    model: 'Gemini 2.5 Flash + Groq + OpenRouter',
    ready: hasAnyKey,
    configurationError: hasAnyKey ? '' : 'Please add your API keys to .env',

    async stream({ system, turns = [], imageDataUrl, maxTokens = 2048, onToken = () => {} }) {
      const sanitizedTurns = sanitizeTurns(turns);
      const hasImage = !!imageDataUrl;
      const discovered = getDiscovered();

      const candidates = [];

      // 1. If screen screenshot is present: Gemini is primary vision model
      if (hasImage && geminiKey) {
        const geminiModels = discovered.validGemini.length > 0 ? discovered.validGemini : ['gemini-2.5-flash'];
        for (const m of geminiModels.slice(0, 2)) {
          candidates.push({
            name: `Gemini Vision (${m})`,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
            apiKey: geminiKey,
            model: m
          });
        }
      }

      // 2. Groq text models (Fastest)
      if (groqKey && !hasImage) {
        const groqModels = discovered.validGroq.length > 0 ? discovered.validGroq : ['qwen/qwen3.8-27b'];
        for (const m of groqModels.slice(0, 2)) {
          candidates.push({
            name: `Groq (${m})`,
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: groqKey,
            model: m
          });
        }
      }

      // 3. Gemini general fallback
      if (geminiKey && !hasImage) {
        const geminiModels = discovered.validGemini.length > 0 ? discovered.validGemini : ['gemini-2.5-flash'];
        for (const m of geminiModels.slice(0, 2)) {
          candidates.push({
            name: `Gemini (${m})`,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
            apiKey: geminiKey,
            model: m
          });
        }
      }

      // 4. OpenRouter Free fallback
      if (openRouterKey) {
        const orModels = discovered.validOpenRouter.length > 0 ? discovered.validOpenRouter : [];
        for (const m of orModels.slice(0, 3)) {
          candidates.push({
            name: `OpenRouter Free (${m})`,
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: openRouterKey,
            model: m
          });
        }
      }

      if (candidates.length === 0) {
        throw new Error('No valid fallback providers available.');
      }

      let lastError = null;

      for (const target of candidates) {
        console.log(`[Remix AI] Routing request to: ${target.name}`);
        try {
          const res = await executeStream({
            baseURL: target.baseURL,
            apiKey: target.apiKey,
            model: target.model,
            system,
            turns: sanitizedTurns,
            imageDataUrl,
            maxTokens,
            onToken
          });
          console.log(`[Remix AI] SUCCESS streaming from: ${target.name}`);
          return res;
        } catch (err) {
          console.warn(`[Remix AI] ${target.name} failed (${err.message}). Shifting to next...`);
          lastError = err;
        }
      }

      throw new Error(`All providers failed. Last error: ${lastError?.message}`);
    }
  };
}

module.exports = {
  createLLM,
  formatProviderErrorMessage,
  isQuotaError,
  CURRENT_GEMINI_DEFAULT: 'gemini-2.5-flash'
};

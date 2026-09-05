const OpenAI = require('openai');

/**
 * Providers configuration
 */
function getProviders(hasImage = false) {
  const groqKey = process.env.GROQ_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const openRouterKey = process.env.OPENROUTER_API_KEY || '';

  if (hasImage) {
    // Vision-capable free pipeline
    return [
      {
        name: 'Gemini 2.0 Flash (Vision Primary)',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: geminiKey,
        model: 'gemini-2.0-flash',
        timeout: 7000
      },
      {
        name: 'Groq Vision (Vision Secondary)',
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: groqKey,
        model: 'llama-3.2-11b-vision-preview',
        timeout: 5000
      },
      {
        name: 'OpenRouter Free Vision',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: openRouterKey,
        model: 'google/gemini-2.0-flash-exp:free',
        timeout: 8000
      }
    ].filter(p => p.apiKey && !p.apiKey.startsWith('YOUR_'));
  }

  // Text & conversation free pipeline (Speed -> Depth -> Reasoner)
  return [
    {
      name: 'Groq Llama 3.3 70B (Ultra-Fast Primary)',
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: groqKey,
      model: 'llama-3.3-70b-versatile',
      timeout: 4000
    },
    {
      name: 'Gemini 2.0 Flash (High Quota Secondary)',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: geminiKey,
      model: 'gemini-2.0-flash',
      timeout: 6000
    },
    {
      name: 'OpenRouter Qwen 2.5 72B (Free Reasoner)',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: openRouterKey,
      model: 'qwen/qwen-2.5-72b-instruct:free',
      timeout: 9000
    }
  ].filter(p => p.apiKey && !p.apiKey.startsWith('YOUR_'));
}

/**
 * Checks if prompt payload contains images
 */
function containsImages(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some(m => {
    if (Array.isArray(m.content)) {
      return m.content.some(part => part.type === 'image_url' || part.type === 'image');
    }
    return false;
  });
}

/**
 * Stream completions with automatic failover
 */
async function streamWithRemixFallback(messages, options = {}) {
  const hasImage = containsImages(messages);
  const providers = getProviders(hasImage);

  if (providers.length === 0) {
    throw new Error('No API keys configured in .env! Please add GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY.');
  }

  let lastError = null;

  for (const provider of providers) {
    console.log(`[Remix AI] Attempting stream with: ${provider.name}`);
    try {
      const client = new OpenAI({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        timeout: provider.timeout,
        maxRetries: 0
      });

      const stream = await client.chat.completions.create({
        model: provider.model,
        messages: messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 2048
      });

      return {
        providerName: provider.name,
        stream: stream
      };
    } catch (err) {
      console.warn(`[Remix AI] ${provider.name} failed (${err.message}). Falling back to next...`);
      lastError = err;
    }
  }

  throw new Error(`All free providers failed. Last error: ${lastError?.message}`);
}

module.exports = {
  streamWithRemixFallback,
  getProviders
};

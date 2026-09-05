require('dotenv').config();
const https = require('https');

function fetchJSON(url, headers = {}) {
  return new Promise((resolve) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null });
        }
      });
    }).on('error', (err) => resolve({ status: 500, error: err.message }));
  });
}

async function discover() {
  console.log('\n=============================================');
  console.log('?? DISCOVERING ACTIVE MODELS FOR YOUR 3 KEYS');
  console.log('=============================================\n');

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  let validGroq = [];
  let validGemini = [];
  let validOpenRouter = [];

  // 1. Check Groq
  if (groqKey) {
    process.stdout.write('Testing Groq... ');
    const res = await fetchJSON('https://api.groq.com/openai/v1/models', {
      'Authorization': `Bearer ${groqKey}`
    });
    if (res.status === 200 && res.data?.data) {
      validGroq = res.data.data.map(m => m.id).filter(id => !id.includes('whisper'));
      console.log(`? FOUND ${validGroq.length} models:`, validGroq.slice(0, 3).join(', '));
    } else {
      console.log(`? Failed (${res.status}) - check GROQ_API_KEY`);
    }
  }

  // 2. Check Gemini
  if (geminiKey) {
    process.stdout.write('Testing Gemini... ');
    const res = await fetchJSON(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
    if (res.status === 200 && res.data?.models) {
      validGemini = res.data.models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
      console.log(`? FOUND ${validGemini.length} models:`, validGemini.slice(0, 3).join(', '));
    } else {
      console.log(`? Failed (${res.status}) - check GEMINI_API_KEY`);
    }
  }

  // 3. Check OpenRouter Free Models
  if (openRouterKey) {
    process.stdout.write('Testing OpenRouter... ');
    const res = await fetchJSON('https://openrouter.ai/api/v1/models', {
      'Authorization': `Bearer ${openRouterKey}`
    });
    if (res.status === 200 && res.data?.data) {
      validOpenRouter = res.data.data
        .filter(m => {
          const isFreePrice = m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0';
          return isFreePrice || m.id.endsWith(':free');
        })
        .map(m => m.id);
      console.log(`? FOUND ${validOpenRouter.length} FREE models:`, validOpenRouter.slice(0, 3).join(', '));
    } else {
      console.log(`? Failed (${res.status}) - check OPENROUTER_API_KEY`);
    }
  }

  return { validGroq, validGemini, validOpenRouter };
}

discover().then(results => {
  const fs = require('fs');
  fs.writeFileSync('discovered-models.json', JSON.stringify(results, null, 2));
  console.log('\nSaved active models to discovered-models.json');
});

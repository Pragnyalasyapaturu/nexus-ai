const { app } = require('@azure/functions');
const Groq = require('groq-sdk');

// Initialize the Groq client. It reads the API key from environment variables.
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// This is the "system prompt" - it tells the LLM how to behave.
// Think of it as setting the AI's personality and rules.
const SYSTEM_PROMPT = `You are Nexus, an expert Azure cloud architect.

Your job: given a user's requirements, recommend a serverless-first, cost-efficient Azure architecture.

You MUST respond with valid JSON only, no extra text, in this exact shape:
{
  "summary": "1-2 sentence overview of the recommendation",
  "services": [
    {
      "name": "Azure service name",
      "purpose": "why this service is included",
      "tier": "recommended pricing tier (e.g., 'Consumption', 'Free', 'Standard S1')"
    }
  ],
  "architecture_pattern": "name of the pattern (e.g., 'Event-driven serverless', 'Static site with API')",
  "reasoning": "2-3 sentences explaining WHY this architecture fits the requirements",
  "tradeoffs": ["bullet 1", "bullet 2", "bullet 3"]
}

Rules:
- Prefer free or consumption-based tiers when possible
- Apply cloud-native principles: loose coupling, fault tolerance, graceful degradation
- Keep services list to 3-6 items (don't over-engineer)
- Output ONLY the JSON, nothing else - no markdown fences, no preamble`;

app.http('recommend', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Recommend function triggered.');

        // 1. Parse the incoming request body
        let body;
        try {
            body = await request.json();
        } catch (err) {
            return {
                status: 400,
                jsonBody: { error: 'Request body must be valid JSON.' }
            };
        }

        const userRequirements = body.requirements;
        if (!userRequirements || typeof userRequirements !== 'string') {
            return {
                status: 400,
                jsonBody: { error: "Missing or invalid 'requirements' field. Send a JSON body like { \"requirements\": \"...\" }" }
            };
        }

        // 2. Call Groq's LLM
        try {
            const completion = await groq.chat.completions.create({
                model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userRequirements }
                ],
                temperature: 0.3,         // Low temp = more consistent, less creative output
                max_tokens: 1500,
                response_format: { type: 'json_object' }  // Forces valid JSON output
            });

            const rawResponse = completion.choices[0]?.message?.content;
            context.log('Raw LLM response:', rawResponse);

            // 3. Parse and validate the JSON the LLM gave us
            let recommendation;
            try {
                recommendation = JSON.parse(rawResponse);
            } catch (parseErr) {
                context.error('LLM returned invalid JSON:', rawResponse);
                return {
                    status: 502,
                    jsonBody: { error: 'LLM returned malformed response. Try rephrasing your request.' }
                };
            }

            // 4. Return the recommendation
            return {
                status: 200,
                jsonBody: {
                    requirements: userRequirements,
                    recommendation,
                    model: process.env.GROQ_MODEL,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (err) {
            context.error('Groq API error:', err);
            return {
                status: 500,
                jsonBody: {
                    error: 'LLM service unavailable',
                    detail: err.message
                }
            };
        }
    }
});
import Anthropic from '@anthropic-ai/sdk';
import { parseBody } from '../_lib/http.js';

export const config = { maxDuration: 60 };

// Generates a monthly financial analysis. The client sends the focus month's
// figures plus prior-month aggregates and past report headlines, so the model
// can comment on longer trends and build on what it said before. Returns a
// structured JSON report the Analysis page renders and saves.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set.' });
    return;
  }
  try {
    const body = parseBody(req);
    const { data } = body;
    if (!data || !data.month) {
      res.status(400).json({ error: 'Missing analysis data.' });
      return;
    }

    const client = new Anthropic({ apiKey });
    const model = process.env.ANALYSIS_MODEL || 'claude-opus-5';

    const system = `You are a sharp, encouraging personal-finance coach reviewing one family's monthly budget. You think like the financially savvy: you care about savings rate, cash flow, lifestyle creep, fixed vs. flexible spending, categories drifting over budget, recurring subscriptions, and building wealth over time — not just this month's totals.

You are given the focus month's numbers, several prior months for trend, and the headlines of your past reports. Use the history: point out trends ("dining has climbed three months running"), not just single-month facts, and build on prior observations.

Respond with ONLY JSON, no prose or code fences:
{
  "headline": string,            // one punchy sentence summarizing the month
  "summary": string,             // 2-4 sentence plain-English overview
  "savingsRate": number | null,  // % of income kept this month, if derivable
  "sections": [                  // 3-6 sections, each a focused theme
    { "heading": string, "points": [string, ...] }
  ],
  "recommendations": [string, ...],  // 3-6 concrete, specific, doable actions
  "watch": [string, ...]             // 1-4 things to keep an eye on next month
}

Guidance:
- Be specific and quantitative — name categories and dollar amounts from the data.
- Prioritize the highest-leverage issues; don't pad.
- Flag categories over budget and categories that are trending up over months.
- Call out wins too (on-track savings, categories under budget).
- Keep each point to one clear sentence. Money figures like $1,234.
- If income or savings can't be computed reliably, say so briefly rather than guessing.`;

    const userText = `Here is the budget data as JSON. Focus month: ${data.monthLabel || data.month}.\n\n${JSON.stringify(data, null, 2)}\n\nWrite the analysis JSON now.`;

    const response = await client.messages.create({
      model,
      max_tokens: 2500,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = parseJsonObject(text);
    if (!parsed || !parsed.headline) {
      res.status(502).json({ error: 'The AI response could not be read. Please try again.' });
      return;
    }

    // Coerce to the expected shape defensively.
    const report = {
      headline: String(parsed.headline || '').slice(0, 300),
      summary: String(parsed.summary || '').slice(0, 2000),
      savingsRate: typeof parsed.savingsRate === 'number' ? parsed.savingsRate : null,
      sections: Array.isArray(parsed.sections)
        ? parsed.sections
            .filter((s) => s && s.heading)
            .map((s) => ({ heading: String(s.heading).slice(0, 120), points: (s.points || []).map((p) => String(p).slice(0, 500)) }))
        : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((p) => String(p).slice(0, 500)) : [],
      watch: Array.isArray(parsed.watch) ? parsed.watch.map((p) => String(p).slice(0, 500)) : [],
    };

    res.status(200).json({ ok: true, report });
  } catch (err) {
    console.error('analysis generate failed:', err?.message || err);
    res.status(502).json({ error: err.message || 'Could not generate the analysis.' });
  }
}

function parseJsonObject(text) {
  const t = (text || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

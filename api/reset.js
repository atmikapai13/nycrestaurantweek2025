// api/reset.js
import { resetAgentState } from './_langgraph/agent.js';

export default function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        resetAgentState();
        return res.status(200).json({ message: 'Agent state reset successfully' });
    } catch (error) {
        console.error('❌ Reset error:', error);
        return res.status(500).json({ error: 'Failed to reset agent state' });
    }
}

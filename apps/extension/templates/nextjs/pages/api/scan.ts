
import { createClient } from '@codeguard/sdk';
import type { NextApiRequest, NextApiResponse } from 'next';

// Initialize CodeGuard Client
// Best practice: Use environment variables for API keys
const client = createClient({
    apiKey: process.env.CODEGUARD_API_KEY,
    // Optional: Configure email for credit tracking
    // email: 'user@example.com' 
});

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { code, region = 'BR' } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        // Perform non-authoritative technical framework review
        const result = await client.scan({
            code,
            region
        });

        res.status(200).json(result);
    } catch (error) {
        console.error('CodeGuard Scan Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

import React, { useState } from 'react';
import { createClient } from '@codeguard/sdk';
import type { TechnicalFrameworkReviewResult } from '@codeguard/sdk';

// Demo configuration; use a backend proxy when handling credentials in a browser.
const client = createClient({ apiKey: 'YOUR_DEMO_KEY' });

export default function TechnicalFrameworkReview() {
    const [code, setCode] = useState('');
    const [review, setReview] = useState<TechnicalFrameworkReviewResult>();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const scan = async () => {
        setLoading(true); setReview(undefined); setError('');
        try {
            const response = await client.scan({ code, region: 'BR' });
            if (!response.success || !response.result) throw new Error('Technical review unavailable');
            setReview(response.result);
        } catch { setError('Unable to establish a technical review.'); }
        finally { setLoading(false); }
    };
    return <main>
        <h1>LLM-Assisted Technical Framework Review</h1>
        <textarea aria-label="Source code" value={code} onChange={event => setCode(event.target.value)} />
        <button onClick={scan} disabled={loading}>{loading ? 'Analyzing...' : 'Review supplied source'}</button>
        {error && <p role="alert">{error}</p>}
        {review && <>
            <p>{review.analysis_boundary.authority}</p>
            {review.limitations.map(limit => <p key={limit}>{limit}</p>)}
            {review.results.map(result => <section key={result.framework}>
                <h2>{result.frameworkName}</h2>
                <p>{result.analysis_state} — Completeness: {result.completeness}</p>
                <p>{result.summary}</p>
                {result.findings.map((finding, index) => <article key={index}>
                    <p>Potential technical finding (untrusted model output): {finding.technical_observation}</p>
                    <p>{finding.file_path}:{finding.line_start} — {finding.severity} engineering priority</p>
                    <p>Reference hint for human review: {finding.reference_hint}</p>
                    <p>Engineering suggestion: {finding.recommendation}</p>
                </article>)}
            </section>)}
        </>}
    </main>;
}

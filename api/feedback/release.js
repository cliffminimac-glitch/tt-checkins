// /api/feedback/release.js
// Marks a submission as "released" so the employee can see manager notes
// Body: { employee, type, period }
// Writes to a NEW timestamped key to avoid CDN stale-content issues.

import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { employee, type, period } = req.body;
    if (!employee || !type || !period) {
      return res.status(400).json({ error: 'Missing fields: employee, type, period' });
    }

    const sanitize = str =>
      String(str).toLowerCase().replace(/[^a-z0-9\-_ ]/g, '').replace(/\s+/g, '_').slice(0, 80);

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const baseKey = `feedback/${sanitize(type)}/${sanitize(employee)}/${sanitize(period)}`;
    const dirPrefix = `feedback/${sanitize(type)}/${sanitize(employee)}/`;

    // List all blobs for this employee/type and find the most recent for this period
    const { blobs } = await list({ prefix: dirPrefix, token });
    const periodBlobs = blobs.filter(b => b.pathname && b.pathname.startsWith(baseKey));

    if (!periodBlobs.length) {
      return res.status(404).json({ error: 'Submission not found', baseKey });
    }

    // Get the latest version
    const latest = periodBlobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];

    // Fetch current content using downloadUrl (bypasses CDN) or url
    const fetchUrl = latest.downloadUrl || latest.url;
    const fetchHeaders = latest.downloadUrl ? { Authorization: `Bearer ${token}` } : {};
    const existingRes = await fetch(fetchUrl, { headers: fetchHeaders });

    let record = {};
    if (existingRes.ok) {
      record = await existingRes.json();
    }

    // Write to a NEW timestamped key — avoids CDN caching entirely
    const ts = Date.now();
    const newKey = `${baseKey}__${ts}.json`;

    await put(newKey, JSON.stringify({
      ...record,
      released: true,
      releasedAt: new Date().toISOString(),
    }), {
      access: 'public',
      contentType: 'application/json',
      token,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('POST /api/feedback/release error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// /api/feedback/release.js
// Marks a submission as "released" so the employee can see manager notes
// Body: { employee, type, period }

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

    const key = `feedback/${sanitize(type)}/${sanitize(employee)}/${sanitize(period)}.json`;
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    const dirPrefix = `feedback/${sanitize(type)}/${sanitize(employee)}/`;
    const { blobs } = await list({ prefix: dirPrefix, token });

    const target = blobs.find(b => b.pathname === key || (b.pathname && b.pathname.endsWith(`/${sanitize(period)}.json`)));
    if (!target) {
      return res.status(404).json({ error: 'Submission not found', key, found: blobs.map(b => b.pathname) });
    }

    // Use downloadUrl (bypasses CDN caching) if available, fall back to url with cache-bust
    const fetchUrl = target.downloadUrl || (target.url + (target.url.includes('?') ? '&' : '?') + '_nc=' + Date.now());
    const existingRes = await fetch(fetchUrl, {
      headers: target.downloadUrl ? { Authorization: `Bearer ${token}` } : {},
    });

    let record = {};
    if (existingRes.ok) {
      record = await existingRes.json();
    }

    const newRecord = { ...record, released: true, releasedAt: new Date().toISOString() };
    const putResult = await put(key, JSON.stringify(newRecord), {
      access: 'public',
      contentType: 'application/json',
      token,
      allowOverwrite: true,
    });

    return res.status(200).json({
      ok: true,
      _debug: {
        key,
        targetPathname: target.pathname,
        targetUrl: target.url.slice(0, 60),
        hasDownloadUrl: !!target.downloadUrl,
        recordPreRelease: { released: record.released, savedAt: record.savedAt },
        putUrl: putResult?.url?.slice(0, 60),
      }
    });
  } catch (err) {
    console.error('POST /api/feedback/release error:', err);
    return res.status(500).json({ error: err.message });
  }
}

import express from 'express';
export function createResolverApp(service) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.post('/dispute', async (req, res) => {
    const b = req.body ?? {};
    if (typeof b.tx_sig !== 'string' || b.tx_sig.length < 80) return res.status(400).json({ error: 'tx_sig required' });
    try { res.json(await service.dispute({ tx_sig: b.tx_sig, mandate: b.mandate ?? null, grant_tx: b.grant_tx ?? null, receipt: b.receipt ?? null })); }
    catch (e) { res.status(502).json({ error: 'resolver_failed', message: e.message }); }
  });
  app.get('/v/:tx', (req, res) => {
    const s = service.stored(req.params.tx);
    res.type('text/plain');
    if (!s) return res.status(404).send(`No verdict stored for ${req.params.tx}.\n`);
    const v = s.verdict;
    res.send([`iussum verdict for payment ${req.params.tx}`, '', `Dispute upheld: ${v.verdict === 'valid' ? 'yes' : 'no'}`, `Reason:         ${v.reason}`, `Liable:         ${v.liable}`, `Mandate id:     ${v.mandate_id ?? '-'}`, `Time used:      ${v.time_source ?? '-'}`, '', 'What differs from what the person authorised:', ...(v.delta.length ? v.delta.map((d) => `  ${d.code ?? d.field}: authorised ${d.authorized}, actual ${d.actual}`) : ['  nothing']), '', `Refund transaction: ${s.refund_tx ?? 'none'}`, ''].join('\n'));
  });
  return app;
}

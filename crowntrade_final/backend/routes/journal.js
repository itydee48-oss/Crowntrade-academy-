const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const trades = await query('SELECT * FROM trade_journal WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    const t = trades.rows;
    const wins = t.filter(x=>x.outcome==='win').length;
    const losses = t.filter(x=>x.outcome==='loss').length;
    const totalPips = t.reduce((s,x)=>s+(parseFloat(x.pips_result)||0),0);
    const rrVals = t.filter(x=>x.rr_result).map(x=>parseFloat(x.rr_result));
    res.json({ trades: t, stats: {
      total_trades: t.length, wins, losses, breakeven: t.filter(x=>x.outcome==='breakeven').length,
      win_rate: t.length ? Math.round(wins/t.length*100) : 0,
      total_pips: parseFloat(totalPips.toFixed(1)),
      avg_rr: rrVals.length ? parseFloat((rrVals.reduce((a,b)=>a+b,0)/rrVals.length).toFixed(2)) : 0
    }});
  } catch(err) { res.status(500).json({ error: 'Failed to get journal' }); }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { pair, direction, entry_price, sl_price, tp_price, setup_type, notes } = req.body;
    if (!pair||!direction||!entry_price||!sl_price||!tp_price) return res.status(400).json({ error: 'Required: pair, direction, entry, SL, TP' });
    const mult = pair.includes('JPY') ? 100 : 10000;
    const slPips = Math.abs(parseFloat(entry_price)-parseFloat(sl_price))*mult;
    const tpPips = Math.abs(parseFloat(tp_price)-parseFloat(entry_price))*mult;
    const rr = slPips > 0 ? parseFloat((tpPips/slPips).toFixed(2)) : 0;
    const r = await query(`INSERT INTO trade_journal (user_id,pair,direction,entry_price,sl_price,tp_price,setup_type,notes,rr_result,outcome)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open') RETURNING *`,
      [req.user.id, pair.toUpperCase(), direction, entry_price, sl_price, tp_price, setup_type||'', notes||'', rr]);
    res.json({ trade: r.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to log trade' }); }
});

router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { exit_price, outcome, notes, setup_type } = req.body;
    const existing = await query('SELECT * FROM trade_journal WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    const t = existing.rows[0];
    if (!t) return res.status(404).json({ error: 'Trade not found' });
    let pips_result = t.pips_result;
    if (exit_price && t.entry_price) {
      const mult = t.pair.includes('JPY') ? 100 : 10000;
      pips_result = t.direction==='buy'
        ? parseFloat(((parseFloat(exit_price)-parseFloat(t.entry_price))*mult).toFixed(1))
        : parseFloat(((parseFloat(t.entry_price)-parseFloat(exit_price))*mult).toFixed(1));
    }
    const r = await query(`UPDATE trade_journal SET exit_price=COALESCE($1,exit_price), outcome=COALESCE($2,outcome),
      notes=COALESCE($3,notes), setup_type=COALESCE($4,setup_type), pips_result=$5 WHERE id=$6 AND user_id=$7 RETURNING *`,
      [exit_price||null, outcome||null, notes||null, setup_type||null, pips_result, req.params.id, req.user.id]);
    res.json({ trade: r.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to update trade' }); }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await query('DELETE FROM trade_journal WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Trade deleted' });
  } catch(err) { res.status(500).json({ error: 'Failed to delete trade' }); }
});

module.exports = router;

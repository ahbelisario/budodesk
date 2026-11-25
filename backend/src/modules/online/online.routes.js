/**
 * /api/v2/online-payments — pagos en línea (PayPal, Mercado Pago)
 *
 *   GET  /options                         métodos activos del dojo (para el alumno)
 *   POST /checkout                        { provider, charge_ids, user_id?, return_base? } → { redirect_url, … }
 *   GET  /:id                             estado del pago
 *   POST /:id/confirm                     al regresar del proveedor: verifica y registra
 *   POST /webhooks/paypal/:dojoId         aviso de PayPal (sin sesión: se verifica la firma)
 *   POST /webhooks/mercadopago/:dojoId    aviso de Mercado Pago (sin sesión: se verifica la firma)
 */
const express = require('express');
const { z } = require('zod');
const { authenticate, requireDojo } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { actingUser } = require('../../utils/acting');
const svc = require('./online.service');

const router = express.Router();
const id = z.coerce.number().int().positive();
const STAFF = ['owner', 'admin', 'staff'];

// --- Avisos de los proveedores (antes de exigir sesión) ---
router.post('/webhooks/paypal/:dojoId', validate({ params: z.object({ dojoId: id }) }), async (req, res) => {
  try {
    const r = await svc.paypalWebhook(req.valid.params.dojoId, req.headers, req.body);
    res.status(r.verified === false ? 400 : 200).json({ received: true });
  } catch (e) {
    console.error('[pagos] aviso PayPal:', e.message);
    res.status(500).json({ received: false }); // el proveedor lo reintenta
  }
});

router.post('/webhooks/mercadopago/:dojoId', validate({ params: z.object({ dojoId: id }) }), async (req, res) => {
  try {
    const r = await svc.mercadopagoWebhook(req.valid.params.dojoId, { headers: req.headers, query: req.query, body: req.body });
    res.status(r.verified === false ? 400 : 200).json({ received: true });
  } catch (e) {
    console.error('[pagos] aviso Mercado Pago:', e.message);
    res.status(500).json({ received: false });
  }
});

router.use(authenticate, requireDojo);

router.get('/options', async (req, res) => {
  res.json({ status: 'success', data: await svc.options(req.auth.dojoId) });
});

router.post('/checkout', validate({
  body: z.object({
    provider: z.enum(['paypal', 'mercadopago']),
    charge_ids: z.array(id).min(1).max(50),
    user_id: id.optional(),
    return_base: z.string().max(200).optional(),
  }),
}), async (req, res) => {
  const b = req.valid.body;
  const uid = await actingUser(req, b.user_id, { staffRoles: STAFF, need: 'pay' });
  const [me] = await req.tdb.query('SELECT u.email FROM users u JOIN dojo_members m ON m.user_id = u.id AND m.dojo_id = :dojoId WHERE u.id = :u', { u: req.auth.userId });
  const data = await svc.createCheckout(req.tdb, {
    dojoId: req.auth.dojoId, userId: uid, createdBy: req.auth.userId, provider: b.provider, chargeIds: b.charge_ids,
    returnBase: b.return_base, payerEmail: me?.email,
  });
  res.status(201).json({ status: 'success', data });
});

async function ownCheckout(req) {
  const c = await svc.getCheckout(req.tdb, req.valid.params.id);
  await actingUser(req, c.user_id, { staffRoles: STAFF, need: 'pay' });
  return c;
}

router.get('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
  res.json({ status: 'success', data: svc.publicCheckout(await ownCheckout(req)) });
});

router.post('/:id/confirm', validate({ params: z.object({ id }), body: z.object({ cancelled: z.boolean().optional() }) }), async (req, res) => {
  await ownCheckout(req);
  res.json({ status: 'success', data: await svc.confirm(req.auth.dojoId, req.valid.params.id, { cancelled: req.valid.body.cancelled }) });
});

module.exports = router;

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = process.env.SITE_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const catalog = JSON.parse(await readFile(path.join(__dirname, 'public', 'catalog.json'), 'utf8'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ ok: true, paymentConfigured: Boolean(MP_ACCESS_TOKEN && SITE_URL) }));

app.post('/api/checkout', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN || !SITE_URL) return res.status(503).json({ error: 'Pagamento ainda não configurado. A loja não está recebendo pedidos.' });
    if (!Array.isArray(req.body?.items) || req.body.items.length < 1 || req.body.items.length > 30) {
      return res.status(400).json({ error: 'Carrinho inválido.' });
    }
    const normalized = [];
    for (const entry of req.body.items) {
      const product = catalog.find(p => p.id === entry.id && p.active === true);
      const quantity = Number(entry.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return res.status(400).json({ error: 'Produto ou quantidade inválida.' });
      }
      if (!Number.isInteger(product.priceCents) || product.priceCents < 1 || !Number.isInteger(product.stock) || product.stock < quantity) {
        return res.status(409).json({ error: `Preço ou estoque de ${product.name} ainda não está configurado.` });
      }
      normalized.push({ external_code: product.id, title: product.name, quantity, unit_price: (product.priceCents / 100).toFixed(2) });
    }
    const totalCents = normalized.reduce((sum, item) => sum + Math.round(Number(item.unit_price) * 100) * item.quantity, 0);
    const orderRef = `VU-${randomUUID()}`;
    const payload = {
      type: 'online',
      total_amount: (totalCents / 100).toFixed(2),
      external_reference: orderRef,
      processing_mode: 'manual',
      capture_mode: 'automatic_async',
      items: normalized,
      config: { online: {
        success_url: `${SITE_URL}/?pagamento=sucesso`,
        failure_url: `${SITE_URL}/?pagamento=falhou`,
        pending_url: `${SITE_URL}/?pagamento=pendente`
      } }
    };
    const mpResponse = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': randomUUID()
      },
      body: JSON.stringify(payload)
    });
    const result = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('Mercado Pago checkout error:', mpResponse.status, result?.message || result?.error || 'unknown');
      return res.status(502).json({ error: 'O Mercado Pago não conseguiu iniciar o pagamento. Revise a configuração com o responsável pela conta.' });
    }
    if (!result.checkout_url) return res.status(502).json({ error: 'O Mercado Pago não retornou o link de pagamento.' });
    return res.status(201).json({ checkout_url: result.checkout_url, order_reference: orderRef });
  } catch (error) {
    console.error('Checkout error:', error.message);
    return res.status(500).json({ error: 'Erro interno ao preparar o pagamento.' });
  }
});

app.listen(PORT, () => console.log(`VitrineUp disponível na porta ${PORT}`));

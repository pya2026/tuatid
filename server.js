// CRUZY LINE Webhook Server
const express = require('express');
const cors = require('cors');
const { messagingApi, middleware } = require('@line/bot-sdk');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// --- Config ---
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const LIFF_URL = process.env.LIFF_URL || 'https://liff.line.me/YOUR_LIFF_ID';
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
  : 'https://tuatid-production-13e1.up.railway.app';

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// --- Orders directory ---
const ordersDir = path.join(__dirname, 'orders');
if (!fs.existsSync(ordersDir)) fs.mkdirSync(ordersDir);

// --- Express app ---
const app = express();

// CORS (for LIFF fetch from GitHub Pages)
app.use(cors());

// Serve PDF files
app.use('/pdf', express.static(ordersDir));

// Health check
app.get('/', (req, res) => {
  res.send('CRUZY LINE Webhook is running!');
});

// ═══════════════════════════════════════════════
//  POST /order — receive order from LIFF,
//  generate PDF, push Flex receipt to LINE chat
// ═══════════════════════════════════════════════
app.post('/order', express.json(), async (req, res) => {
  try {
    const { orderId, bigItems, smallItems, total, userId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'missing orderId' });

    const now = new Date();
    const dateStr =
      now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    // ── Generate PDF ─────────────────────────
    const filename = orderId.replace('#', '') + '.pdf';
    const filepath = path.join(ordersDir, filename);
    const pdfUrl = BASE_URL + '/pdf/' + filename;

    await generatePDF(filepath, { orderId, bigItems, smallItems, total, dateStr });

    // ── Push Flex Message to user ────────────
    if (userId) {
      const flexMsg = buildReceiptFlex(orderId, bigItems, smallItems, total, dateStr, pdfUrl);
      await client.pushMessage({ to: userId, messages: [flexMsg] });
    }

    res.json({ success: true, pdfUrl });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
//  PDF Generation (pdfkit)
// ═══════════════════════════════════════════════
function generatePDF(filepath, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const gold = '#C9A800';

    // ── Header ──
    doc.rect(0, 0, 595, 100).fill('#1a1a1a');
    doc.fontSize(28).font('Helvetica-Bold').fillColor(gold).text('CRUZY', 50, 30, { align: 'center' });
    doc.fontSize(11).fillColor('#cccccc').text('3D Sticker Order Summary', 50, 62, { align: 'center' });

    // ── Order info ──
    doc.fillColor('#333333');
    doc.moveDown(3);
    doc.fontSize(12).font('Helvetica-Bold').text('Order:  ' + data.orderId);
    doc.fontSize(10).font('Helvetica').text('Date:   ' + data.dateStr);
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e0e0e0').stroke();
    doc.moveDown(1);

    // ── Big stickers ──
    if (data.bigItems && data.bigItems.length > 0) {
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#2c5282')
        .text('BIG Stickers  (' + data.bigItems.length + ' bags)');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').fillColor('#444444')
        .text(data.bigItems.map(id => '#' + id).join(',  '), { width: 495 });
      doc.moveDown(1);
    }

    // ── Small stickers ──
    if (data.smallItems && data.smallItems.length > 0) {
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#2b6cb0')
        .text('SMALL Stickers  (' + data.smallItems.length + ' bags)');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').fillColor('#444444')
        .text(data.smallItems.map(id => '#' + id).join(',  '), { width: 495 });
      doc.moveDown(1);
    }

    // ── Divider ──
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(gold).lineWidth(2).stroke();
    doc.moveDown(1);

    // ── Total ──
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text('Total:  ' + data.total + '  bags   (Big ' + (data.bigItems ? data.bigItems.length : 0) + ' / Small ' + (data.smallItems ? data.smallItems.length : 0) + ')');

    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica').fillColor('#999999')
      .text('Thank you for your order!  CRUZY team will contact you within 24 hours.', { align: 'center' });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ═══════════════════════════════════════════════
//  Build Flex Message receipt
// ═══════════════════════════════════════════════
function buildReceiptFlex(orderId, bigItems, smallItems, total, dateStr, pdfUrl) {
  const bodyContents = [
    { type: 'text', text: orderId, weight: 'bold', size: 'lg', color: '#1a1a1a' },
    { type: 'text', text: dateStr, size: 'xs', color: '#999999', margin: 'sm' },
    { type: 'separator', margin: 'lg' }
  ];

  if (bigItems && bigItems.length > 0) {
    bodyContents.push({
      type: 'box', layout: 'horizontal', margin: 'lg',
      contents: [
        { type: 'text', text: 'BIG', weight: 'bold', size: 'sm', color: '#2c5282', flex: 2 },
        { type: 'text', text: bigItems.length + ' bags', size: 'sm', color: '#444444', align: 'end', flex: 1 }
      ]
    });
    bodyContents.push({
      type: 'text', text: bigItems.map(id => '#' + id).join(', '),
      size: 'xs', color: '#888888', wrap: true, margin: 'sm'
    });
  }

  if (smallItems && smallItems.length > 0) {
    bodyContents.push({
      type: 'box', layout: 'horizontal', margin: 'lg',
      contents: [
        { type: 'text', text: 'SMALL', weight: 'bold', size: 'sm', color: '#2b6cb0', flex: 2 },
        { type: 'text', text: smallItems.length + ' bags', size: 'sm', color: '#444444', align: 'end', flex: 1 }
      ]
    });
    bodyContents.push({
      type: 'text', text: smallItems.map(id => '#' + id).join(', '),
      size: 'xs', color: '#888888', wrap: true, margin: 'sm'
    });
  }

  bodyContents.push({ type: 'separator', margin: 'lg' });
  bodyContents.push({
    type: 'box', layout: 'horizontal', margin: 'lg',
    contents: [
      { type: 'text', text: 'Total', weight: 'bold', size: 'md', color: '#1a1a1a' },
      { type: 'text', text: total + ' bags', weight: 'bold', size: 'md', color: '#C9A800', align: 'end' }
    ]
  });

  return {
    type: 'flex',
    altText: 'CRUZY Order ' + orderId,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: 'CRUZY', color: '#F5C518', weight: 'bold', size: 'lg', align: 'center' },
          { type: 'text', text: 'Order Confirmed', color: '#ffffff', size: 'xs', align: 'center', margin: 'sm' }
        ],
        backgroundColor: '#1a1a1a',
        paddingAll: '16px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: bodyContents,
        paddingAll: '16px'
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: 'Download PDF', uri: pdfUrl },
            style: 'primary',
            color: '#F5C518'
          },
          {
            type: 'text',
            text: 'CRUZY team will contact you within 24 hrs.',
            size: 'xxs', color: '#999999', align: 'center', margin: 'md'
          }
        ],
        paddingAll: '12px'
      }
    }
  };
}

// ═══════════════════════════════════════════════
//  LINE Webhook — keyword trigger
// ═══════════════════════════════════════════════
app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ success: true }))
    .catch((err) => {
      console.error('Error:', err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const text = event.message.text.trim();
  const keywords = ['\u0E2A\u0E31\u0E48\u0E07\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14', '\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14', 'sticker', '3d'];
  const matched = keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
  if (!matched) return null;

  const flexMessage = {
    type: 'flex',
    altText: '\u0E2A\u0E31\u0E48\u0E07\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14 3D - CRUZY',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'box', layout: 'vertical',
          contents: [{ type: 'text', text: 'CRUZY', color: '#F5C518', size: 'xs', weight: 'bold', align: 'center' }],
          backgroundColor: '#1a1a1a', cornerRadius: '12px', paddingAll: '20px'
        }],
        paddingAll: '16px', backgroundColor: '#1a1a1a'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '\u2728 \u0E2A\u0E31\u0E48\u0E07\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14 3D', weight: 'bold', size: 'lg', color: '#333333' },
          { type: 'text', text: '\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C\u0E40\u0E2A\u0E23\u0E34\u0E21\u0E21\u0E34\u0E19\u0E34\u0E41\u0E1A\u0E23\u0E19\u0E14\u0E4C  \u0E15\u0E31\u0E27\u0E15\u0E34\u0E14 3D\n\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E25\u0E32\u0E22/\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E0B\u0E2B\u0E4C \u0E2A\u0E31\u0E48\u0E07\u0E44\u0E14\u0E49\u0E2B\u0E25\u0E32\u0E22\u0E41\u0E1A\u0E1A\u0E43\u0E19\u0E04\u0E23\u0E31\u0E49\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27\u0E41\u0E1A\u0E1A\u0E1A', size: 'sm', color: '#888888', margin: 'md', wrap: true }
        ],
        paddingAll: '16px'
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '\u0E40\u0E1B\u0E34\u0E14\u0E2A\u0E31\u0E48\u0E07\u0E0B\u0E37\u0E49\u0E2D', uri: LIFF_URL },
          style: 'primary', color: '#F5C518', height: 'md'
        }],
        paddingAll: '12px'
      }
    }
  };

  return client.replyMessage({ replyToken: event.replyToken, messages: [flexMessage] });
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('CRUZY webhook listening on port ' + PORT);
});

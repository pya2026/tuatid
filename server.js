const express = require('express');
const { messagingApi, middleware } = require('@line/bot-sdk');

// --- Config ---
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const LIFF_URL = process.env.LIFF_URL || 'https://liff.line.me/YOUR_LIFF_ID';

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// --- Express app ---
const app = express();

// Health check
app.get('/', (req, res) => {
  res.send('CRUZY LINE Webhook is running!');
});

// LINE webhook endpoint
app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ success: true }))
    .catch((err) => {
      console.error('Error:', err);
      res.status(500).end();
    });
});

// --- Handle events ---
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const text = event.message.text.trim();

  // Trigger keywords
  const keywords = ['\u0E2A\u0E31\u0E48\u0E07\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14', '\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14', 'sticker', '3d'];
  const matched = keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));

  if (!matched) return null;

  // Flex Message
  const flexMessage = {
    type: 'flex',
    altText: '\u0E2A\u0E31\u0E48\u0E07\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14 3D - CRUZY',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'text',
            text: 'CRUZY',
            color: '#F5C518',
            size: 'xs',
            weight: 'bold',
            align: 'center',
          }],
          backgroundColor: '#1a1a1a',
          cornerRadius: '12px',
          paddingAll: '20px',
        }],
        paddingAll: '16px',
        backgroundColor: '#1a1a1a',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '\u2728 \u0E2A\u0E31\u0E48\u0E07\u0E15\u0E31\u0E27\u0E15\u0E34\u0E14 3D',
            weight: 'bold',
            size: 'lg',
            color: '#333333',
          },
          {
            type: 'text',
            text: '\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C\u0E40\u0E2A\u0E23\u0E34\u0E21\u0E21\u0E34\u0E19\u0E34\u0E41\u0E1A\u0E23\u0E19\u0E14\u0E4C  \u0E15\u0E31\u0E27\u0E15\u0E34\u0E14 3D\n\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E25\u0E32\u0E22/\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E0B\u0E2B\u0E4C \u0E2A\u0E31\u0E48\u0E07\u0E44\u0E14\u0E49\u0E2B\u0E25\u0E32\u0E22\u0E41\u0E1A\u0E1A\u0E43\u0E19\u0E04\u0E23\u0E31\u0E49\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27\u0E41\u0E1A\u0E1A\u0E1A',
            size: 'sm',
            color: '#888888',
            margin: 'md',
            wrap: true,
          },
        ],
        paddingAll: '16px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          action: {
            type: 'uri',
            label: '\u0E40\u0E1B\u0E34\u0E14\u0E2A\u0E31\u0E48\u0E07\u0E0B\u0E37\u0E49\u0E2D',
            uri: LIFF_URL,
          },
          style: 'primary',
          color: '#F5C518',
          height: 'md',
        }],
        paddingAll: '12px',
      },
    },
  };

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [flexMessage],
  });
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('CRUZY webhook listening on port ' + PORT);
});

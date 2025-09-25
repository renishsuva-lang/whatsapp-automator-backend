
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
// Render provides the PORT environment variable
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

let client;
let sessionStatus = 'DISCONNECTED';
let qrCodeData = null;

const initializeWhatsApp = () => {
    // Prevent re-initialization if one is already in progress
    if (sessionStatus === 'CONNECTING' && client) return;

    console.log('Initializing WhatsApp Client...');
    sessionStatus = 'CONNECTING'; // Set status immediately
    
    // Optimized puppeteer args for low-memory environments like Render
    const puppeteerOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Crucial for low-memory
            '--disable-gpu'
        ],
    };

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }), // Specify a path for Render's ephemeral filesystem
        puppeteer: puppeteerOptions,
    });

    client.on('qr', (qr) => {
        console.log('QR code received, generating data URL...');
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error('Error generating QR code data URL:', err);
                sessionStatus = 'ERROR';
                return;
            }
            qrCodeData = url;
            console.log('QR code data URL generated.');
        });
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is ready!');
        sessionStatus = 'CONNECTED';
        qrCodeData = null;
    });

    client.on('disconnected', (reason) => {
        console.log('Client was logged out:', reason);
        sessionStatus = 'DISCONNECTED';
        client.destroy();
        qrCodeData = null;
    });

    client.on('auth_failure', (msg) => {
        console.error('Authentication failure:', msg);
        sessionStatus = 'ERROR';
    });

    client.initialize().catch(err => {
        console.error("Failed to initialize WhatsApp client:", err.message);
        sessionStatus = 'ERROR';
        // Clean up on failure
        if (client) {
            client.destroy();
        }
    });
};

app.get('/api/whatsapp/connect', (req, res) => {
    if (sessionStatus === 'CONNECTED') {
        return res.json({ status: 'Already connected' });
    }
    // Only initialize if fully disconnected or in an error state
    if (sessionStatus === 'DISCONNECTED' || sessionStatus === 'ERROR') {
       initializeWhatsApp();
    }
    res.status(202).json({ status: 'Connection process initiated.' });
});

app.get('/api/whatsapp/status', (req, res) => {
    res.json({ status: sessionStatus, qrCode: qrCodeData });
});

app.post('/api/whatsapp/send-bulk', async (req, res) => {
    if (sessionStatus !== 'CONNECTED') {
        return res.status(400).json({ success: false, message: 'WhatsApp client is not connected.' });
    }
    const messages = req.body.messages;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ success: false, message: 'Invalid request: "messages" array not found.' });
    }
    console.log(`Received bulk send request for ${messages.length} messages.`);
    res.json({ success: true, message: 'Bulk sending process started in the background.' });

    (async () => {
        for (const item of messages) {
            try {
                const chatId = `${item.phone.replace(/\D/g, '')}@c.us`;
                const media = new MessageMedia('image/png', item.imageBase64, 'personalized-image.png');
                await client.sendMessage(chatId, media, { caption: item.message });
                console.log(`Message successfully sent to ${item.phone}`);
                await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
            } catch (error) {
                console.error(`Failed to send message to ${item.phone}:`, error.message);
            }
        }
        console.log('Bulk sending process finished.');
    })();
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
        if (sessionStatus === 'CONNECTED' && client) {
            console.log('Attempting to disconnect client...');
            await client.logout();
            console.log('Client successfully logged out.');
        }
    } catch (err) {
        console.error('An error occurred during client logout:', err.message);
        // Even if logout fails, we proceed to reset the state
    } finally {
        sessionStatus = 'DISCONNECTED';
        client = null; // Clean up the client instance
        qrCodeData = null; // Clean up QR code data
        console.log('Session has been reset to DISCONNECTED.');
        res.status(200).json({ success: true, message: 'Disconnection process finished.' });
    }
});

app.listen(port, () => {
    console.log(`WhatsApp backend server listening on port ${port}`);
});

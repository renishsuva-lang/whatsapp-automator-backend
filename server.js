
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
// Increase the limit to handle base64 image strings
app.use(express.json({ limit: '10mb' }));

let client;
let sessionStatus = 'DISCONNECTED';
let qrCodeData = null;

const initializeWhatsApp = () => {
    console.log('Initializing WhatsApp Client...');
    
    // These puppeteer args are essential for running in a container or on most cloud platforms
    const puppeteerOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // This may or may not be needed
            '--disable-gpu'
        ],
    };

    client = new Client({
        authStrategy: new LocalAuth(), // This saves the session to a local file
        puppeteer: puppeteerOptions,
    });

    client.on('qr', (qr) => {
        console.log('QR code received, generating data URL...');
        sessionStatus = 'CONNECTING';
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
        qrCodeData = null; // Clear QR code once connected
    });

    client.on('disconnected', (reason) => {
        console.log('Client was logged out:', reason);
        sessionStatus = 'DISCONNECTED';
        client.destroy();
        // Optional: you could re-initialize here if you want it to always be ready
        // initializeWhatsApp();
    });

    client.on('auth_failure', (msg) => {
        console.error('Authentication failure:', msg);
        sessionStatus = 'ERROR';
    });

    client.initialize().catch(err => {
        console.error("Failed to initialize WhatsApp client:", err);
        sessionStatus = 'ERROR';
    });
};

// Endpoint for the frontend to start the connection process
app.get('/api/whatsapp/connect', (req, res) => {
    if (sessionStatus === 'CONNECTED') {
        return res.json({ status: 'Already connected' });
    }
    if (sessionStatus === 'DISCONNECTED' || sessionStatus === 'ERROR') {
       initializeWhatsApp();
    }
    res.status(202).json({ status: 'Connection process initiated.' });
});

// Endpoint for the frontend to poll for the current status and QR code
app.get('/api/whatsapp/status', (req, res) => {
    res.json({ status: sessionStatus, qrCode: qrCodeData });
});

// Endpoint to handle sending messages in bulk
app.post('/api/whatsapp/send-bulk', async (req, res) => {
    if (sessionStatus !== 'CONNECTED') {
        return res.status(400).json({ success: false, message: 'WhatsApp client is not connected.' });
    }

    const messages = req.body.messages;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ success: false, message: 'Invalid request: "messages" array not found.' });
    }

    console.log(`Received bulk send request for ${messages.length} messages.`);
    
    // Respond immediately to the frontend to avoid timeouts
    res.json({ success: true, message: 'Bulk sending process started in the background.' });

    // Process each message in the background
    (async () => {
        for (const item of messages) {
            try {
                // Sanitize phone number and add the country code if missing (assuming US for this example)
                let sanitizedPhone = item.phone.replace(/\D/g, '');
                const chatId = `${sanitizedPhone}@c.us`;
                
                const media = new MessageMedia('image/png', item.imageBase64, 'personalized-image.png');
                
                await client.sendMessage(chatId, media, { caption: item.message });
                console.log(`Message successfully sent to ${item.phone}`);
                
                // Add a small delay to avoid being flagged as spam by WhatsApp
                await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000)); // 1-3 second delay

            } catch (error) {
                console.error(`Failed to send message to ${item.phone}:`, error.message);
            }
        }
        console.log('Bulk sending process finished.');
    })();
});


// Endpoint to disconnect the session
app.post('/api/whatsapp/disconnect', async (req, res) => {
    if (sessionStatus === 'CONNECTED' && client) {
        console.log('Disconnecting client...');
        await client.logout();
        res.json({ success: true, message: 'Successfully disconnected.' });
    } else {
        sessionStatus = 'DISCONNECTED'; // Force status update
        res.status(200).json({ success: true, message: 'Client was not connected or already disconnected.' });
    }
});

app.listen(port, () => {
    console.log(`WhatsApp backend server listening at http://localhost:${port}`);
});
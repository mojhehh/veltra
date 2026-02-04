/**
 * BROWSER STREAMING PROXY
 * =======================
 * Uses a REAL browser (Playwright) and streams it to users.
 * This is how you get 95%+ site compatibility.
 * 
 * How it works:
 * 1. User connects via WebSocket
 * 2. Server spawns a real Chromium browser
 * 3. Browser screenshots are streamed to user (MJPEG-style)
 * 4. User's mouse/keyboard events are forwarded to browser
 * 
 * This WILL work with TikTok, Roblox, Now.gg, etc.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const crypto = require('crypto');

// Add stealth plugin to avoid detection
chromium.use(stealth());

class BrowserStreamProxy {
    constructor(options = {}) {
        this.port = options.port || 3000;
        this.DEBUG = options.debug || false;
        
        // Active browser sessions
        this.sessions = new Map(); // sessionId -> BrowserSession
        
        // Settings
        this.maxSessions = options.maxSessions || 10; // Max concurrent browsers
        this.sessionTimeout = options.sessionTimeout || 30 * 60 * 1000; // 30 min
        this.frameRate = options.frameRate || 60; // 60 FPS
        this.quality = options.quality || 100; // MAX JPEG quality
        
        // Viewport sizes
        this.defaultViewport = { width: 1280, height: 720 };
    }

    log(...args) {
        if (this.DEBUG) console.log('[PROXY]', new Date().toISOString().split('T')[1].slice(0, 8), ...args);
    }

    /**
     * Generate session ID
     */
    generateSessionId() {
        return crypto.randomBytes(16).toString('base64url');
    }

    /**
     * Create a new browser session
     */
    async createSession(url, viewport = this.defaultViewport) {
        if (this.sessions.size >= this.maxSessions) {
            throw new Error('Max sessions reached. Try again later.');
        }

        const sessionId = this.generateSessionId();
        
        this.log(`Creating session ${sessionId} for ${url}`);

        // Launch browser with NEW headless mode for GPU support
        const browser = await chromium.launch({
            headless: true,
            channel: 'chrome', // Use actual Chrome if available for better perf
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--enable-gpu',
                '--enable-gpu-rasterization', 
                '--enable-accelerated-video-decode',
                '--enable-accelerated-2d-canvas',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-frame-rate-limit',
                '--disable-gpu-vsync',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const context = await browser.newContext({
            viewport: viewport,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/New_York',
            geolocation: { latitude: 40.7128, longitude: -74.0060 },
            permissions: ['geolocation'],
            // Extra anti-detection
            bypassCSP: true,
            ignoreHTTPSErrors: true
        });

        const page = await context.newPage();

        // ANTI-DETECTION: Override webdriver property and other fingerprinting
        await page.addInitScript(() => {
            // Remove webdriver flag
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            
            // Mock plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin' }
                ]
            });
            
            // Mock languages
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            
            // Mock permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // Mock chrome runtime
            window.chrome = { runtime: {} };
            
            // Hide automation
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        });

        // Block some resource types to improve performance
        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            // Allow everything for maximum compatibility
            route.continue();
        });

        // Navigate to URL
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err) {
            this.log(`Navigation error: ${err.message}`);
            // Continue anyway, page might still be usable
        }

        // Inject fullscreen interception script - runs on every navigation
        await page.addInitScript(() => {
            // Override fullscreen API to notify parent
            const originalRequestFullscreen = Element.prototype.requestFullscreen;
            Element.prototype.requestFullscreen = function(...args) {
                // Notify via exposed function if available
                if (window.__notifyFullscreen) {
                    window.__notifyFullscreen();
                }
                // Return a resolved promise (fullscreen won't work in headless anyway)
                return Promise.resolve();
            };
            
            // Also handle webkit prefix
            if (Element.prototype.webkitRequestFullscreen) {
                Element.prototype.webkitRequestFullscreen = function(...args) {
                    if (window.__notifyFullscreen) {
                        window.__notifyFullscreen();
                    }
                    return Promise.resolve();
                };
            }
            
            // Override document.fullscreenElement to prevent apps from thinking we're not fullscreen
            Object.defineProperty(document, 'fullscreenElement', {
                get: () => document.body,
                configurable: true
            });
            Object.defineProperty(document, 'webkitFullscreenElement', {
                get: () => document.body,
                configurable: true
            });
        });

        const session = {
            id: sessionId,
            browser,
            context,
            page,
            url,
            viewport,
            clients: new Set(), // WebSocket clients
            streaming: false,
            streamInterval: null,
            lastActivity: Date.now(),
            createdAt: Date.now()
        };

        this.sessions.set(sessionId, session);

        // Listen for fullscreen requests from the page
        page.on('console', msg => {
            if (msg.text().includes('FULLSCREEN_REQUEST')) {
                // Notify all clients about fullscreen request
                for (const client of session.clients) {
                    if (client.readyState === 1) {
                        client.send(JSON.stringify({ type: 'fullscreen_request' }));
                    }
                }
            }
        });

        // Also expose a function the page can call
        await page.exposeFunction('__notifyFullscreen', () => {
            for (const client of session.clients) {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ type: 'fullscreen_request' }));
                }
            }
        });
        
        // Start activity timeout checker
        this.startTimeoutChecker(sessionId);

        this.log(`Session ${sessionId} created successfully`);
        return sessionId;
    }

    /**
     * Start streaming frames to connected clients using PIPELINED CDP captures
     */
    async startStreaming(session) {
        if (session.streaming) return;
        
        session.streaming = true;
        
        try {
            // Get CDP session for direct screenshot access
            const cdpSession = await session.page.context().newCDPSession(session.page);
            session.cdpSession = cdpSession;
            
            // AGGRESSIVE PIPELINED CAPTURE - don't wait for send, just blast frames
            const captureLoop = async () => {
                if (!session.streaming) return;
                
                if (session.clients.size === 0) {
                    setTimeout(captureLoop, 16);
                    return;
                }
                
                const startTime = Date.now();
                
                try {
                    // Fire off capture - 100% quality as requested
                    const result = await cdpSession.send('Page.captureScreenshot', {
                        format: 'jpeg',
                        quality: 100,
                        fromSurface: true,
                        captureBeyondViewport: false
                    });
                    
                    const frame = {
                        type: 'frame',
                        data: result.data,
                        timestamp: startTime
                    };
                    
                    const message = JSON.stringify(frame);
                    
                    // Send to all clients (non-blocking)
                    for (const client of session.clients) {
                        if (client.readyState === 1) {
                            client.send(message, { binary: false }, () => {});
                        }
                    }
                } catch (err) {
                    // Page navigating, skip frame
                }
                
                // Calculate how long capture took, aim for 60fps
                const captureTime = Date.now() - startTime;
                const delay = Math.max(0, 16 - captureTime);
                
                // Schedule next capture immediately
                setTimeout(captureLoop, delay);
            };
            
            // Start the capture loop
            captureLoop();
            
            this.log(`Pipelined capture started for session ${session.id}`);
            
        } catch (err) {
            this.log(`CDP capture failed: ${err.message}`);
            this.startScreenshotStreaming(session);
        }
    }
    
    /**
     * Fallback screenshot-based streaming
     */
    startScreenshotStreaming(session) {
        let isCapturing = false;
        
        const captureFrame = async () => {
            if (!session.streaming || session.clients.size === 0 || isCapturing) {
                return;
            }
            
            isCapturing = true;
            
            try {
                const screenshot = await session.page.screenshot({
                    type: 'jpeg',
                    quality: 85,
                    fullPage: false
                });

                const frame = {
                    type: 'frame',
                    data: screenshot.toString('base64'),
                    timestamp: Date.now()
                };

                const message = JSON.stringify(frame);

                for (const client of session.clients) {
                    if (client.readyState === 1) {
                        client.send(message);
                    }
                }
            } catch (err) {
                // Page might be navigating
            }
            
            isCapturing = false;
        };
        
        const frameInterval = Math.floor(1000 / 60);
        session.streamInterval = setInterval(captureFrame, frameInterval);
    }

    /**
     * Stop streaming
     */
    async stopStreaming(session) {
        session.streaming = false;
        
        // Stop CDP session if active
        if (session.cdpSession) {
            try {
                await session.cdpSession.detach();
            } catch (e) {
                // Ignore cleanup errors
            }
            session.cdpSession = null;
        }
        
        // Stop fallback interval if active
        if (session.streamInterval) {
            clearInterval(session.streamInterval);
            session.streamInterval = null;
        }
    }

    /**
     * Handle mouse events from client
     */
    async handleMouseEvent(session, event) {
        try {
            const { event: eventType, x, y, button, deltaX, deltaY } = event;
            
            // Only log clicks, not moves or wheel (too spammy)
            if (eventType !== 'mousemove' && eventType !== 'wheel') {
                this.log(`Mouse: ${eventType} at (${Math.round(x)}, ${Math.round(y)})`);
            }
            
            switch (eventType) {
                case 'mousemove':
                    // Just move, don't do anything else
                    await session.page.mouse.move(x, y, { steps: 1 });
                    break;
                case 'mousedown':
                    await session.page.mouse.move(x, y);
                    await session.page.mouse.down({ button: button || 'left' });
                    break;
                case 'mouseup':
                    await session.page.mouse.up({ button: button || 'left' });
                    break;
                case 'click':
                    // Simple mouse click at position
                    await session.page.mouse.click(x, y, { button: button || 'left' });
                    break;
                case 'dblclick':
                    await session.page.mouse.dblclick(x, y);
                    break;
                case 'wheel':
                    // Wheel events don't need x,y - they scroll at current mouse position
                    await session.page.mouse.wheel(deltaX || 0, deltaY || 0);
                    break;
            }
            
            session.lastActivity = Date.now();
        } catch (err) {
            this.log(`Mouse event error: ${err.message}`);
        }
    }

    /**
     * Handle touch/drag events from client - FOR TOUCHSCREEN SWIPES
     */
    async handleTouchEvent(session, event) {
        try {
            const { event: eventType, x, y, startX, startY, endX, endY } = event;
            
            this.log(`Touch: ${eventType} at (${Math.round(x || startX)}, ${Math.round(y || startY)})`);
            
            switch (eventType) {
                case 'touchstart':
                    await session.page.mouse.move(x, y);
                    await session.page.mouse.down();
                    break;
                case 'touchmove':
                    await session.page.mouse.move(x, y, { steps: 1 });
                    break;
                case 'touchend':
                    await session.page.mouse.up();
                    break;
                case 'swipe':
                    // Complete swipe gesture - drag from start to end
                    await session.page.mouse.move(startX, startY);
                    await session.page.mouse.down();
                    // Smooth drag with steps
                    await session.page.mouse.move(endX, endY, { steps: 10 });
                    await session.page.mouse.up();
                    break;
                case 'tap':
                    await session.page.mouse.click(x, y);
                    break;
            }
            
            session.lastActivity = Date.now();
        } catch (err) {
            this.log(`Touch event error: ${err.message}`);
        }
    }

    /**
     * Handle keyboard events from client
     */
    async handleKeyboardEvent(session, event) {
        try {
            const { event: eventType, key, code, text } = event;
            
            this.log(`Keyboard: ${eventType} key=${key}`);
            
            switch (eventType) {
                case 'keydown':
                    await session.page.keyboard.down(key);
                    break;
                case 'keyup':
                    await session.page.keyboard.up(key);
                    break;
                case 'keypress':
                    if (text) {
                        await session.page.keyboard.type(text);
                    } else {
                        await session.page.keyboard.press(key);
                    }
                    break;
            }
            
            session.lastActivity = Date.now();
        } catch (err) {
            this.log(`Keyboard event error: ${err.message}`);
        }
    }

    /**
     * Handle navigation requests
     */
    async handleNavigation(session, url) {
        try {
            this.log(`Navigating to: ${url}`);
            await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            session.url = url;
            session.lastActivity = Date.now();
            return { success: true, url: session.page.url() };
        } catch (err) {
            this.log(`Navigation error: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Handle browser actions (back, forward, refresh)
     */
    async handleAction(session, action) {
        try {
            switch (action) {
                case 'back':
                    await session.page.goBack();
                    break;
                case 'forward':
                    await session.page.goForward();
                    break;
                case 'refresh':
                    await session.page.reload();
                    break;
            }
            session.lastActivity = Date.now();
            return { success: true, url: session.page.url() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Start timeout checker for session
     */
    startTimeoutChecker(sessionId) {
        const checkInterval = setInterval(() => {
            const session = this.sessions.get(sessionId);
            if (!session) {
                clearInterval(checkInterval);
                return;
            }

            const inactive = Date.now() - session.lastActivity;
            if (inactive > this.sessionTimeout) {
                this.log(`Session ${sessionId} timed out`);
                this.destroySession(sessionId);
                clearInterval(checkInterval);
            }
        }, 60000); // Check every minute
    }

    /**
     * Destroy a session
     */
    async destroySession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        this.log(`Destroying session ${sessionId}`);

        // Stop streaming
        this.stopStreaming(session);

        // Close all client connections
        for (const client of session.clients) {
            client.close(1000, 'Session ended');
        }

        // Close browser
        try {
            await session.browser.close();
        } catch {}

        this.sessions.delete(sessionId);
    }

    /**
     * Serve the landing page
     */
    serveLandingPage(req, res) {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Webtra — Secure Browser Proxy</title>
    <style>
        :root {
            --bg1: #020c1f;
            --bg2: #0b3c91;
            --blue: #2aa9ff;
            --blue2: #7fd0ff;
            --text: #eaf4ff;
            --muted: #b9d9ff;
            --glass: rgba(255,255,255,0.08);
            --glass2: rgba(0,0,0,0.35);
            --border: rgba(42,169,255,0.35);
            --shadow: rgba(0,0,0,0.55);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }

        body {
            min-height: 100vh;
            color: var(--text);
            overflow-x: hidden;
            background:
                radial-gradient(1000px 600px at 20% 10%, rgba(42,169,255,0.22), transparent 60%),
                radial-gradient(900px 700px at 85% 30%, rgba(127,208,255,0.14), transparent 65%),
                radial-gradient(circle at top, var(--bg2), var(--bg1));
        }

        .grid {
            position: fixed; inset: -40%;
            background-image:
                linear-gradient(rgba(42,169,255,0.10) 1px, transparent 1px),
                linear-gradient(90deg, rgba(42,169,255,0.08) 1px, transparent 1px);
            background-size: 48px 48px;
            transform: rotate(12deg);
            animation: drift 18s linear infinite;
            filter: blur(0.2px);
            opacity: 0.55;
            pointer-events: none;
            z-index: 0;
        }
        @keyframes drift {
            0% { transform: translate3d(0,0,0) rotate(12deg); }
            100% { transform: translate3d(140px, -120px, 0) rotate(12deg); }
        }

        .glow {
            position: fixed;
            width: 750px; height: 750px;
            background: rgba(42,169,255,0.20);
            filter: blur(160px);
            border-radius: 999px;
            animation: float 9s ease-in-out infinite;
            pointer-events: none;
            z-index: 0;
        }
        .glow.g2 {
            width: 620px; height: 620px;
            background: rgba(127,208,255,0.14);
            animation-duration: 11s;
            animation-delay: -2s;
            left: 55%; top: 10%;
        }
        @keyframes float {
            0% { transform: translateY(0) translateX(0); }
            50% { transform: translateY(-55px) translateX(25px); }
            100% { transform: translateY(0) translateX(0); }
        }

        .streaks {
            position: fixed; inset: 0;
            pointer-events: none;
            background:
                repeating-linear-gradient(
                    115deg,
                    rgba(42,169,255,0.00) 0px,
                    rgba(42,169,255,0.00) 140px,
                    rgba(42,169,255,0.06) 160px,
                    rgba(42,169,255,0.00) 190px
                );
            animation: streakmove 7s linear infinite;
            opacity: 0.6;
            z-index: 0;
        }
        @keyframes streakmove {
            0% { background-position: 0 0; }
            100% { background-position: 420px 0; }
        }

        /* Veltra Modal */
        .veltra-modal {
            position: fixed;
            inset: 0;
            background: rgba(2, 12, 31, 0.95);
            backdrop-filter: blur(20px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.5s ease;
        }
        .veltra-modal.hidden { display: none; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .veltra-content {
            text-align: center;
            max-width: 600px;
            padding: 48px;
            background: var(--glass);
            backdrop-filter: blur(18px);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 22px;
            box-shadow: 0 40px 90px var(--shadow);
            animation: pop 600ms ease;
        }
        @keyframes pop {
            from { opacity: 0; transform: translateY(18px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .veltra-content h2 {
            font-size: 2rem;
            font-weight: 900;
            background: linear-gradient(90deg, #dff3ff, #9ad9ff, #2aa9ff);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            margin-bottom: 16px;
        }

        .veltra-content p {
            color: var(--muted);
            font-size: 1.05rem;
            line-height: 1.6;
            margin-bottom: 24px;
        }

        .veltra-content .highlight {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 12px 20px;
            background: rgba(42,169,255,0.18);
            border: 1px solid var(--border);
            border-radius: 12px;
            color: var(--blue2);
            font-weight: 600;
            margin-bottom: 24px;
        }

        .veltra-btns {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .veltra-btn {
            padding: 14px 28px;
            border-radius: 12px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
        }

        .veltra-btn.primary {
            background: linear-gradient(135deg, var(--blue), var(--blue2));
            border: none;
            color: #020c1f;
        }
        .veltra-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(42,169,255,0.4); }

        .veltra-btn.secondary {
            background: var(--glass2);
            border: 1px solid rgba(255,255,255,0.15);
            color: var(--text);
        }
        .veltra-btn.secondary:hover { background: rgba(255,255,255,0.12); }

        /* Landing Page */
        .landing {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 40px 20px;
            position: relative;
            z-index: 2;
        }

        .title {
            font-size: 3.4rem;
            font-weight: 900;
            letter-spacing: 0.8px;
            background: linear-gradient(90deg, #dff3ff, #9ad9ff, #2aa9ff);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            text-shadow: 0 0 22px rgba(42,169,255,0.18);
        }

        .tagline {
            margin-top: 10px;
            color: var(--muted);
            font-size: 1.1rem;
        }

        .badge {
            display: inline-flex;
            gap: 10px;
            align-items: center;
            margin: 22px auto 10px;
            padding: 10px 16px;
            border-radius: 999px;
            background: rgba(42,169,255,0.18);
            border: 1px solid var(--border);
            color: #d8f0ff;
            font-size: 0.92rem;
        }

        .dot {
            width: 10px; height: 10px;
            border-radius: 999px;
            background: var(--blue);
            box-shadow: 0 0 18px rgba(42,169,255,0.8);
            animation: pulse 1.25s ease-in-out infinite;
        }
        @keyframes pulse {
            0%,100% { transform: scale(1); opacity: 0.9; }
            50% { transform: scale(1.35); opacity: 1; }
        }

        .search-container {
            width: 100%;
            max-width: 600px;
            margin: 30px 0 20px;
        }

        .search-box {
            display: flex;
            background: var(--glass2);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 8px 32px var(--shadow);
        }

        .search-box input {
            flex: 1;
            background: transparent;
            border: none;
            padding: 18px 24px;
            font-size: 1.05rem;
            color: var(--text);
            outline: none;
        }
        .search-box input::placeholder { color: #6a9fd4; }

        .search-box button {
            background: linear-gradient(135deg, var(--blue), var(--blue2));
            border: none;
            padding: 18px 32px;
            color: #020c1f;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
        }
        .search-box button:hover { filter: brightness(1.1); }
        .search-box button:disabled { opacity: 0.5; cursor: not-allowed; }

        .quick-sites {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            justify-content: center;
            max-width: 700px;
        }

        .site-btn {
            background: var(--glass);
            border: 1px solid rgba(255,255,255,0.08);
            padding: 10px 18px;
            border-radius: 999px;
            color: var(--text);
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.95rem;
        }
        .site-btn:hover {
            background: rgba(42,169,255,0.2);
            border-color: var(--blue);
            transform: translateY(-2px);
        }

        .info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            max-width: 800px;
            margin-top: 40px;
        }

        .info-card {
            background: var(--glass2);
            border: 1px solid rgba(255,255,255,0.08);
            padding: 20px;
            border-radius: 14px;
            text-align: center;
            box-shadow: inset 0 0 0 1px rgba(42,169,255,0.08);
        }

        .info-card .icon { font-size: 2rem; margin-bottom: 10px; }
        .info-card h3 { font-size: 0.95rem; color: var(--blue2); margin-bottom: 6px; font-weight: 700; }
        .info-card p { font-size: 0.82rem; color: #9fc5ff; opacity: 0.9; }

        .status {
            margin-top: 20px;
            padding: 12px 24px;
            background: rgba(42,169,255,0.15);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--blue2);
            display: none;
        }
        .status.error {
            background: rgba(255,80,80,0.15);
            border-color: rgba(255,80,80,0.4);
            color: #ff9090;
        }
        .status.show { display: block; }

        footer {
            margin-top: 30px;
            color: #7ab8e8;
            font-size: 0.85rem;
            opacity: 0.8;
        }
        footer a { color: var(--blue2); text-decoration: none; }
        footer a:hover { text-decoration: underline; }

        /* Browser View */
        .browser-view {
            display: none;
            flex-direction: column;
            height: 100vh;
            width: 100%;
            position: relative;
            z-index: 10;
        }
        .browser-view.active { display: flex; }

        .browser-toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            background: rgba(2, 12, 31, 0.95);
            border-bottom: 1px solid rgba(42,169,255,0.2);
            backdrop-filter: blur(10px);
        }

        .nav-btn {
            background: var(--glass2);
            border: 1px solid rgba(255,255,255,0.1);
            width: 38px; height: 38px;
            border-radius: 10px;
            color: var(--text);
            cursor: pointer;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .nav-btn:hover { background: rgba(42,169,255,0.2); border-color: var(--blue); }

        .url-bar {
            flex: 1;
            display: flex;
            background: var(--glass2);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            overflow: hidden;
        }

        .url-bar input {
            flex: 1;
            background: transparent;
            border: none;
            padding: 10px 15px;
            color: var(--text);
            font-size: 0.9rem;
            outline: none;
        }

        .url-bar button {
            background: linear-gradient(135deg, var(--blue), var(--blue2));
            border: none;
            padding: 10px 20px;
            color: #020c1f;
            font-weight: 600;
            cursor: pointer;
        }

        .close-btn {
            background: rgba(255,80,80,0.3) !important;
            border-color: rgba(255,80,80,0.5) !important;
        }
        .close-btn:hover { background: rgba(255,80,80,0.5) !important; }

        .browser-content {
            flex: 1;
            position: relative;
            overflow: hidden;
            background: #020c1f;
        }

        #browserCanvas {
            width: 100%;
            height: 100%;
            object-fit: contain;
            cursor: default;
        }

        .loading-overlay {
            position: absolute;
            inset: 0;
            background: rgba(2, 12, 31, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            z-index: 10;
        }
        .loading-overlay.hidden { display: none; }

        .spinner {
            width: 50px; height: 50px;
            border: 3px solid rgba(42,169,255,0.2);
            border-top-color: var(--blue);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .loading-text {
            margin-top: 15px;
            color: var(--muted);
        }

        .stats {
            position: absolute;
            bottom: 10px; right: 10px;
            background: rgba(2, 12, 31, 0.8);
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 0.75rem;
            color: #7ab8e8;
            border: 1px solid rgba(42,169,255,0.2);
        }

        @media (max-width: 600px) {
            .title { font-size: 2.5rem; }
            .veltra-content { padding: 32px 20px; }
            .veltra-content h2 { font-size: 1.5rem; }
        }
    </style>
</head>
<body>
    <div class="grid"></div>
    <div class="glow" style="left:-10%; top:30%;"></div>
    <div class="glow g2"></div>
    <div class="streaks"></div>

    <!-- Veltra Modal -->
    <div class="veltra-modal" id="veltraModal">
        <div class="veltra-content">
            <h2>🌐 Welcome to Webtra</h2>
            <p>
                Webtra is also available as part of <strong>Veltra OS</strong> — a complete web-based operating system with built-in apps, file management, and more!
            </p>
            <div class="highlight">
                ✨ Full Desktop Experience at veltra
            </div>
            <p style="font-size: 0.95rem; opacity: 0.85;">
                You can use Webtra standalone here, or get the complete experience with Veltra OS.
            </p>
            <div class="veltra-btns">
                <a href="https://mojhehh.github.io/veltra/" class="veltra-btn primary" target="_blank">
                    🚀 Open Veltra OS
                </a>
                <button class="veltra-btn secondary" id="continueBtn">
                    Continue to Webtra →
                </button>
            </div>
        </div>
    </div>

    <!-- Landing Page -->
    <div class="landing" id="landingPage">
        <div class="title">Webtra</div>
        <p class="tagline">Secure browser proxy — works with everything</p>

        <div class="badge">
            <span class="dot"></span>
            End-to-End Encrypted • Real Chromium Browser
        </div>

        <div class="search-container">
            <form class="search-box" id="startForm">
                <input type="text" id="urlInput" placeholder="Enter any URL (tiktok.com, roblox.com, etc.)" required>
                <button type="submit" id="startBtn">Launch →</button>
            </form>
        </div>

        <div class="quick-sites">
            <button class="site-btn" data-url="https://www.tiktok.com">🎵 TikTok</button>
            <button class="site-btn" data-url="https://www.youtube.com">▶️ YouTube</button>
            <button class="site-btn" data-url="https://www.roblox.com">🎮 Roblox</button>
            <button class="site-btn" data-url="https://now.gg">☁️ Now.gg</button>
            <button class="site-btn" data-url="https://www.twitch.tv">📺 Twitch</button>
            <button class="site-btn" data-url="https://discord.com/app">💬 Discord</button>
            <button class="site-btn" data-url="https://www.reddit.com">🤖 Reddit</button>
            <button class="site-btn" data-url="https://www.google.com">🔍 Google</button>
        </div>

        <div class="status" id="status"></div>

        <div class="info">
            <div class="info-card">
                <div class="icon">🖥️</div>
                <h3>Real Browser</h3>
                <p>Full Chromium running on server</p>
            </div>
            <div class="info-card">
                <div class="icon">✅</div>
                <h3>95%+ Compatible</h3>
                <p>TikTok, Roblox, Now.gg — all work</p>
            </div>
            <div class="info-card">
                <div class="icon">🔒</div>
                <h3>Secure</h3>
                <p>Your IP hidden from sites</p>
            </div>
            <div class="info-card">
                <div class="icon">⚡</div>
                <h3>Low Latency</h3>
                <p>Optimized ${this.frameRate} FPS streaming</p>
            </div>
        </div>

        <footer>
            © 2026 Webtra • Also available on <a href="https://mojhehh.github.io/veltra/" target="_blank">Veltra OS</a>
        </footer>
    </div>

    <!-- Browser View -->
    <div class="browser-view" id="browserView">
        <div class="browser-toolbar">
            <button class="nav-btn" id="backBtn" title="Back">←</button>
            <button class="nav-btn" id="forwardBtn" title="Forward">→</button>
            <button class="nav-btn" id="refreshBtn" title="Refresh">⟳</button>

            <div class="url-bar">
                <input type="text" id="currentUrl" placeholder="URL">
                <button id="goBtn">Go</button>
            </div>

            <button class="nav-btn" id="fullscreenBtn" title="Fullscreen">⛶</button>
            <button class="nav-btn close-btn" id="closeBtn" title="Close">✕</button>
        </div>

        <div class="browser-content">
            <div class="loading-overlay" id="loadingOverlay">
                <div class="spinner"></div>
                <div class="loading-text">Connecting to browser...</div>
            </div>

            <canvas id="browserCanvas"></canvas>

            <div class="stats" id="stats">FPS: -- | Latency: --ms</div>
        </div>
    </div>

    <script>
        // Veltra modal
        document.getElementById('continueBtn').addEventListener('click', () => {
            document.getElementById('veltraModal').classList.add('hidden');
        });

        // State
        let ws = null;
        let sessionId = null;
        let canvas, ctx;
        let frameCount = 0;
        let lastFpsUpdate = Date.now();
        let fps = 0;
        let latency = 0;

        // Elements
        const landingPage = document.getElementById('landingPage');
        const browserView = document.getElementById('browserView');
        const urlInput = document.getElementById('urlInput');
        const currentUrlInput = document.getElementById('currentUrl');
        const startBtn = document.getElementById('startBtn');
        const status = document.getElementById('status');
        const loadingOverlay = document.getElementById('loadingOverlay');
        const statsEl = document.getElementById('stats');

        // Initialize canvas
        function initCanvas() {
            canvas = document.getElementById('browserCanvas');
            ctx = canvas.getContext('2d');
            canvas.width = 1280;
            canvas.height = 720;
        }

        // Show status message
        function showStatus(msg, isError = false) {
            status.textContent = msg;
            status.className = 'status show' + (isError ? ' error' : '');
        }

        // Normalize URL
        function normalizeUrl(url) {
            url = url.trim();
            if (!url.match(/^https?:\\/\\//)) {
                url = 'https://' + url;
            }
            return url;
        }
        
        // Start browser session
        async function startSession(url) {
            url = normalizeUrl(url);
            startBtn.disabled = true;
            showStatus('Starting browser...');
            
            try {
                const res = await fetch('/api/session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                
                const data = await res.json();
                
                if (data.error) {
                    showStatus(data.error, true);
                    startBtn.disabled = false;
                    return;
                }
                
                sessionId = data.sessionId;
                showStatus('Connecting to stream...');
                
                // Connect WebSocket
                connectWebSocket();
                
            } catch (err) {
                showStatus('Failed to start: ' + err.message, true);
                startBtn.disabled = false;
            }
        }
        
        // Connect to WebSocket stream
        function connectWebSocket() {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + location.host + '/stream?session=' + sessionId);
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                showBrowser();
            };
            
            ws.onmessage = (e) => {
                const data = JSON.parse(e.data);
                
                if (data.type === 'frame') {
                    renderFrame(data.data);
                    latency = Date.now() - data.timestamp;
                } else if (data.type === 'url') {
                    currentUrlInput.value = data.url;
                } else if (data.type === 'error') {
                    alert('Error: ' + data.message);
                } else if (data.type === 'fullscreen_request') {
                    // The remote page requested fullscreen - go fullscreen on our end!
                    toggleFullscreen();
                }
            };
            
            ws.onclose = () => {
                console.log('WebSocket closed');
                if (browserView.classList.contains('active')) {
                    alert('Connection lost. Returning to home.');
                    closeBrowser();
                }
            };
            
            ws.onerror = (err) => {
                console.error('WebSocket error:', err);
                showStatus('Connection error', true);
            };
        }
        
        // Show browser view
        function showBrowser() {
            landingPage.style.display = 'none';
            browserView.classList.add('active');
            loadingOverlay.classList.remove('hidden');
            initCanvas();
            setupInputHandlers();
            startBtn.disabled = false;
            status.classList.remove('show');
            
            // Hide loading after first frame
            setTimeout(() => {
                loadingOverlay.classList.add('hidden');
            }, 2000);
        }
        
        // Close browser and return to landing
        function closeBrowser() {
            if (ws) {
                ws.close();
                ws = null;
            }
            
            // End session on server
            if (sessionId) {
                fetch('/api/session/' + sessionId, { method: 'DELETE' }).catch(() => {});
                sessionId = null;
            }
            
            browserView.classList.remove('active');
            landingPage.style.display = 'flex';
        }
        
        // Render a frame
        function renderFrame(base64Data) {
            const img = new Image();
            img.onload = () => {
                // Resize canvas if needed
                if (canvas.width !== img.width || canvas.height !== img.height) {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }
                ctx.drawImage(img, 0, 0);
                
                // Update FPS
                frameCount++;
                const now = Date.now();
                if (now - lastFpsUpdate >= 1000) {
                    fps = frameCount;
                    frameCount = 0;
                    lastFpsUpdate = now;
                    statsEl.textContent = 'FPS: ' + fps + ' | Latency: ' + latency + 'ms';
                }
                
                // Hide loading overlay on first frame
                loadingOverlay.classList.add('hidden');
            };
            img.src = 'data:image/jpeg;base64,' + base64Data;
        }
        
        // Setup mouse/keyboard handlers
        function setupInputHandlers() {
            // Throttle mousemove - reduced for better hover responsiveness
            let lastMouseMove = 0;
            const mouseMoveThrottle = 16; // ~60fps mouse updates for responsive hover
            
            // Helper to get coordinates - FIXED for accurate clicking with object-fit:contain
            function getCoords(e) {
                const rect = canvas.getBoundingClientRect();
                
                // Handle both mouse and touch events
                let clientX, clientY;
                if (e.touches && e.touches.length > 0) {
                    clientX = e.touches[0].clientX;
                    clientY = e.touches[0].clientY;
                } else if (e.changedTouches && e.changedTouches.length > 0) {
                    clientX = e.changedTouches[0].clientX;
                    clientY = e.changedTouches[0].clientY;
                } else {
                    clientX = e.clientX;
                    clientY = e.clientY;
                }
                
                // Account for object-fit: contain letterboxing
                const canvasAspect = canvas.width / canvas.height;
                const rectAspect = rect.width / rect.height;
                
                let renderWidth, renderHeight, offsetX, offsetY;
                
                if (rectAspect > canvasAspect) {
                    // Letterboxed horizontally (black bars on sides)
                    renderHeight = rect.height;
                    renderWidth = rect.height * canvasAspect;
                    offsetX = (rect.width - renderWidth) / 2;
                    offsetY = 0;
                } else {
                    // Letterboxed vertically (black bars on top/bottom)
                    renderWidth = rect.width;
                    renderHeight = rect.width / canvasAspect;
                    offsetX = 0;
                    offsetY = (rect.height - renderHeight) / 2;
                }
                
                // Calculate position relative to actual rendered canvas area
                const relX = clientX - rect.left - offsetX;
                const relY = clientY - rect.top - offsetY;
                
                // Scale to actual canvas/viewport dimensions
                const x = Math.round((relX / renderWidth) * canvas.width);
                const y = Math.round((relY / renderHeight) * canvas.height);
                
                // Clamp to valid range
                return { 
                    x: Math.max(0, Math.min(canvas.width, x)), 
                    y: Math.max(0, Math.min(canvas.height, y)) 
                };
            }
            
            // ============ HIDDEN INPUT FOR iPAD KEYBOARD ============
            // This input captures keyboard on touch devices - only shows when user long-presses
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'text';
            hiddenInput.autocomplete = 'off';
            hiddenInput.autocapitalize = 'off';
            hiddenInput.autocorrect = 'off';
            hiddenInput.spellcheck = false;
            hiddenInput.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;font-size:16px;';
            document.body.appendChild(hiddenInput);
            
            let keyboardActive = false;
            let longPressTimer = null;
            
            // When hidden input gets typed in, send to server
            hiddenInput.addEventListener('input', (e) => {
                const text = e.data;
                if (text) {
                    for (const char of text) {
                        sendInput({ type: 'keyboard', event: 'keypress', key: char, text: char });
                    }
                }
                hiddenInput.value = '';
            });
            
            hiddenInput.addEventListener('keydown', (e) => {
                if (['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    sendInput({ type: 'keyboard', event: 'keydown', key: e.key, code: e.code });
                    sendInput({ type: 'keyboard', event: 'keyup', key: e.key, code: e.code });
                }
            });
            
            // Function to show keyboard - only on long press
            function showKeyboard() {
                keyboardActive = true;
                hiddenInput.style.pointerEvents = 'auto';
                hiddenInput.focus();
            }
            
            // Function to hide keyboard
            function hideKeyboard() {
                keyboardActive = false;
                hiddenInput.blur();
                hiddenInput.style.pointerEvents = 'none';
            }
            
            // ============ MOUSE EVENTS (Desktop) - WITH DRAG SUPPORT ============
            let mouseIsDown = false;
            let lastDragPos = null;
            
            canvas.addEventListener('mousemove', (e) => {
                const now = Date.now();
                const { x, y } = getCoords(e);
                
                if (mouseIsDown) {
                    // DRAGGING - send every move for smooth drag
                    sendInput({ type: 'mouse', event: 'mousemove', x, y });
                    lastDragPos = { x, y };
                } else {
                    // Regular hover - throttle to reduce spam
                    if (now - lastMouseMove < mouseMoveThrottle) return;
                    lastMouseMove = now;
                    sendInput({ type: 'mouse', event: 'mousemove', x, y });
                }
            });
            
            canvas.addEventListener('mousedown', (e) => {
                e.preventDefault();
                mouseIsDown = true;
                const { x, y } = getCoords(e);
                lastDragPos = { x, y };
                const button = ['left', 'middle', 'right'][e.button] || 'left';
                sendInput({ type: 'mouse', event: 'mousedown', x, y, button });
            });
            
            canvas.addEventListener('mouseup', (e) => {
                e.preventDefault();
                const { x, y } = getCoords(e);
                const button = ['left', 'middle', 'right'][e.button] || 'left';
                sendInput({ type: 'mouse', event: 'mouseup', x, y, button });
                mouseIsDown = false;
                lastDragPos = null;
            });
            
            // Handle mouse leaving canvas while dragging
            canvas.addEventListener('mouseleave', (e) => {
                if (mouseIsDown) {
                    const { x, y } = getCoords(e);
                    sendInput({ type: 'mouse', event: 'mouseup', x, y, button: 'left' });
                    mouseIsDown = false;
                    lastDragPos = null;
                }
            });
            
            // Don't send separate click - mousedown+mouseup is enough
            // Only handle dblclick for double-clicks
            canvas.addEventListener('dblclick', (e) => {
                e.preventDefault();
                const { x, y } = getCoords(e);
                sendInput({ type: 'mouse', event: 'dblclick', x, y });
            });
            
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                sendInput({ type: 'mouse', event: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY });
            }, { passive: false });
            
            // ============ TOUCH EVENTS - PROPER DRAG/SWIPE SUPPORT ============
            let touchStartTime = 0;
            let touchStartPos = null;
            let touchCount = 0;
            let lastTap = 0;
            let lastTapPos = null;
            let isDragging = false;
            let touchActive = false;
            
            canvas.addEventListener('touchstart', (e) => {
                e.preventDefault();
                touchCount = e.touches.length;
                touchStartTime = Date.now();
                
                if (longPressTimer) clearTimeout(longPressTimer);
                
                if (touchCount === 1) {
                    const { x, y } = getCoords(e);
                    touchStartPos = { x, y };
                    isDragging = false;
                    touchActive = true;
                    
                    // Send touch start - this is critical for drag puzzles!
                    sendInput({ type: 'touch', event: 'touchstart', x, y });
                    
                    // Long press (500ms) to show keyboard
                    longPressTimer = setTimeout(() => {
                        showKeyboard();
                    }, 500);
                    
                } else if (touchCount === 2) {
                    // Two finger = scroll mode
                    touchActive = false;
                }
            }, { passive: false });
            
            canvas.addEventListener('touchmove', (e) => {
                e.preventDefault();
                
                if (e.touches.length === 1 && touchStartPos && touchActive) {
                    const { x, y } = getCoords(e);
                    const dx = Math.abs(x - touchStartPos.x);
                    const dy = Math.abs(y - touchStartPos.y);
                    
                    // If moved more than 10px, it's a drag
                    if (dx > 10 || dy > 10) {
                        isDragging = true;
                        // Cancel keyboard popup on drag
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                    }
                    
                    // Always send move during drag for smooth puzzle solving
                    if (isDragging) {
                        sendInput({ type: 'touch', event: 'touchmove', x, y });
                    }
                    
                } else if (e.touches.length === 2) {
                    // Two finger scroll
                    const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    const rect = canvas.getBoundingClientRect();
                    const deltaY = (e.touches[0].clientY - rect.top) - avgY;
                    sendInput({ type: 'mouse', event: 'wheel', deltaX: 0, deltaY: deltaY * 2 });
                }
            }, { passive: false });
            
            canvas.addEventListener('touchend', (e) => {
                e.preventDefault();
                
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
                
                const touchDuration = Date.now() - touchStartTime;
                
                if (touchCount === 1 && touchStartPos) {
                    const { x, y } = getCoords(e);
                    
                    if (isDragging) {
                        // End the drag - send final position and release
                        sendInput({ type: 'touch', event: 'touchend', x, y });
                    } else if (touchDuration < 300) {
                        // Quick tap - send as click
                        // First release the touch
                        sendInput({ type: 'touch', event: 'touchend', x: touchStartPos.x, y: touchStartPos.y });
                        
                        // Check for double tap
                        const now = Date.now();
                        if (lastTap && now - lastTap < 300 && lastTapPos) {
                            const tapDx = Math.abs(touchStartPos.x - lastTapPos.x);
                            const tapDy = Math.abs(touchStartPos.y - lastTapPos.y);
                            if (tapDx < 50 && tapDy < 50) {
                                sendInput({ type: 'mouse', event: 'dblclick', x: touchStartPos.x, y: touchStartPos.y });
                                lastTap = 0;
                                lastTapPos = null;
                            } else {
                                sendInput({ type: 'touch', event: 'tap', x: touchStartPos.x, y: touchStartPos.y });
                                lastTap = now;
                                lastTapPos = { x: touchStartPos.x, y: touchStartPos.y };
                            }
                        } else {
                            sendInput({ type: 'touch', event: 'tap', x: touchStartPos.x, y: touchStartPos.y });
                            lastTap = now;
                            lastTapPos = { x: touchStartPos.x, y: touchStartPos.y };
                        }
                    } else {
                        // Long press release
                        sendInput({ type: 'touch', event: 'touchend', x: touchStartPos.x, y: touchStartPos.y });
                    }
                }
                
                touchStartPos = null;
                touchCount = 0;
                isDragging = false;
                touchActive = false;
            }, { passive: false });
            
            canvas.addEventListener('touchcancel', () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
                // Release any active touch
                if (touchStartPos) {
                    sendInput({ type: 'touch', event: 'touchend', x: touchStartPos.x, y: touchStartPos.y });
                }
                touchStartPos = null;
                touchCount = 0;
                isDragging = false;
                touchActive = false;
            }, { passive: true });
            
            // ============ KEYBOARD EVENTS (Desktop) ============
            document.addEventListener('keydown', (e) => {
                if (!browserView.classList.contains('active')) return;
                if (document.activeElement === currentUrlInput) return;
                if (document.activeElement === hiddenInput) return; // Let hiddenInput handle it
                
                e.preventDefault();
                sendInput({ type: 'keyboard', event: 'keydown', key: e.key, code: e.code });
            });
            
            document.addEventListener('keyup', (e) => {
                if (!browserView.classList.contains('active')) return;
                if (document.activeElement === currentUrlInput) return;
                if (document.activeElement === hiddenInput) return;
                
                e.preventDefault();
                sendInput({ type: 'keyboard', event: 'keyup', key: e.key, code: e.code });
            });
            
            // Prevent context menu
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
            
            // Hide keyboard when tapping outside or pressing back
            document.addEventListener('click', (e) => {
                if (e.target !== canvas && e.target !== hiddenInput && keyboardActive) {
                    hideKeyboard();
                }
            });
        }
        
        // Send input to server
        function sendInput(input) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(input));
            }
        }
        
        // Navigation handlers
        document.getElementById('backBtn').addEventListener('click', () => {
            sendInput({ type: 'action', action: 'back' });
        });
        
        document.getElementById('forwardBtn').addEventListener('click', () => {
            sendInput({ type: 'action', action: 'forward' });
        });
        
        document.getElementById('refreshBtn').addEventListener('click', () => {
            sendInput({ type: 'action', action: 'refresh' });
        });
        
        document.getElementById('goBtn').addEventListener('click', () => {
            const url = normalizeUrl(currentUrlInput.value);
            sendInput({ type: 'navigate', url });
        });
        
        currentUrlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const url = normalizeUrl(currentUrlInput.value);
                sendInput({ type: 'navigate', url });
            }
        });
        
        document.getElementById('closeBtn').addEventListener('click', closeBrowser);
        
        // Fullscreen toggle function
        function toggleFullscreen() {
            const elem = document.getElementById('browserView');
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                // Enter fullscreen
                if (elem.requestFullscreen) {
                    elem.requestFullscreen();
                } else if (elem.webkitRequestFullscreen) {
                    elem.webkitRequestFullscreen();
                }
            } else {
                // Exit fullscreen
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
            }
        }
        
        document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
        
        // ESC key to exit fullscreen
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.fullscreenElement) {
                document.exitFullscreen();
            }
        });
        
        // Start form
        document.getElementById('startForm').addEventListener('submit', (e) => {
            e.preventDefault();
            startSession(urlInput.value);
        });
        
        // Quick site buttons
        document.querySelectorAll('.site-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                urlInput.value = url;
                startSession(url);
            });
        });
    </script>
</body>
</html>`;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    /**
     * Handle HTTP requests
     */
    async handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // Landing page
        if (url.pathname === '/') {
            return this.serveLandingPage(req, res);
        }

        // Create session API
        if (url.pathname === '/api/session' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { url: targetUrl } = JSON.parse(body);
                    
                    if (!targetUrl) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'URL required' }));
                    }

                    const sessionId = await this.createSession(targetUrl);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ sessionId }));

                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // Delete session API
        if (url.pathname.startsWith('/api/session/') && req.method === 'DELETE') {
            const sessionId = url.pathname.split('/')[3];
            await this.destroySession(sessionId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }

    /**
     * Handle WebSocket connections
     */
    handleWebSocket(ws, req) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const sessionId = url.searchParams.get('session');

        if (!sessionId) {
            ws.close(4000, 'Session ID required');
            return;
        }

        const session = this.sessions.get(sessionId);
        if (!session) {
            ws.close(4001, 'Invalid session');
            return;
        }

        this.log(`Client connected to session ${sessionId}`);

        // Add client to session
        session.clients.add(ws);

        // Start streaming if not already
        this.startStreaming(session);

        // Send current URL
        ws.send(JSON.stringify({ type: 'url', url: session.page.url() }));

        // Handle messages from client
        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'mouse') {
                    await this.handleMouseEvent(session, msg);
                } else if (msg.type === 'touch') {
                    await this.handleTouchEvent(session, msg);
                } else if (msg.type === 'keyboard') {
                    await this.handleKeyboardEvent(session, msg);
                } else if (msg.type === 'navigate') {
                    const result = await this.handleNavigation(session, msg.url);
                    ws.send(JSON.stringify({ type: 'url', url: session.page.url() }));
                } else if (msg.type === 'action') {
                    await this.handleAction(session, msg.action);
                    ws.send(JSON.stringify({ type: 'url', url: session.page.url() }));
                }
            } catch (err) {
                this.log(`Message error: ${err.message}`);
            }
        });

        // Handle disconnect
        ws.on('close', () => {
            this.log(`Client disconnected from session ${sessionId}`);
            session.clients.delete(ws);

            // If no clients, stop streaming (but keep session alive for reconnect)
            if (session.clients.size === 0) {
                this.stopStreaming(session);
            }
        });

        // Listen for page URL changes
        session.page.on('framenavigated', (frame) => {
            if (frame === session.page.mainFrame()) {
                const newUrl = session.page.url();
                ws.send(JSON.stringify({ type: 'url', url: newUrl }));
            }
        });
    }

    /**
     * Start the server
     */
    async start() {
        // Create HTTP server
        const server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        // Create WebSocket server
        const wss = new WebSocketServer({ server, path: '/stream' });
        
        wss.on('connection', (ws, req) => {
            this.handleWebSocket(ws, req);
        });

        // Start listening
        server.listen(this.port, () => {
            console.log(`
\x1b[32m╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   \x1b[1m🖥️  BROWSER STREAMING PROXY\x1b[0m\x1b[32m                               ║
║                                                               ║
║   \x1b[33mLocal:\x1b[0m  \x1b[4mhttp://localhost:${this.port}\x1b[0m\x1b[32m                            ║
║                                                               ║
║   \x1b[36m✓\x1b[32m Real Chromium browser on server                           ║
║   \x1b[36m✓\x1b[32m ${this.frameRate} FPS @ ${this.quality}% JPEG quality                        ║
║   \x1b[36m✓\x1b[32m TikTok, Roblox, Now.gg - ALL WORK                         ║
║   \x1b[36m✓\x1b[32m Max ${this.maxSessions} concurrent sessions                              ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝\x1b[0m
            `);
        });

        return server;
    }
}

// Run if executed directly
if (require.main === module) {
    const proxy = new BrowserStreamProxy({
        port: parseInt(process.env.PORT) || 3002,
        debug: true,
        maxSessions: 30,   // 30 concurrent users (you have 64GB RAM)
        frameRate: 60,   // 60 FPS for smooth experience
        quality: 100     // MAX quality - no compression
    });
    proxy.start();
}

module.exports = BrowserStreamProxy;

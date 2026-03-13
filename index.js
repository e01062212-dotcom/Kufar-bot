const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const fs = require('fs');

// ===== НАСТРОЙКИ =====
const TELEGRAM_TOKEN = '8618512256:AAF6r3mEGGpm1UE-znIumzWl7WR3SR4b46E';
const YOUR_CHAT_ID = '6790605865';
const CHECK_INTERVAL = 60000;
// ====================

const TRACKED_ITEMS_FILE = './tracked_items.json';
const SEEN_ADS_FILE = './seen_ads.json';

let trackedItems = [];
if (fs.existsSync(TRACKED_ITEMS_FILE)) {
    try {
        const data = fs.readFileSync(TRACKED_ITEMS_FILE, 'utf8');
        trackedItems = JSON.parse(data);
    } catch (e) {
        trackedItems = [];
    }
}

let seenAds = new Set();
if (fs.existsSync(SEEN_ADS_FILE)) {
    try {
        const data = fs.readFileSync(SEEN_ADS_FILE, 'utf8');
        seenAds = new Set(JSON.parse(data));
    } catch (e) {
        seenAds = new Set();
    }
}

function saveTrackedItems() {
    fs.writeFileSync(TRACKED_ITEMS_FILE, JSON.stringify(trackedItems, null, 2));
}

function saveSeenAds() {
    fs.writeFileSync(SEEN_ADS_FILE, JSON.stringify([...seenAds]));
}

// СОЗДАЁМ БОТА С ПРИНУДИТЕЛЬНЫМ СБРОСОМ
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Принудительно удаляем все старые подключения
bot.deleteWebHook().then(() => {
    console.log('✅ Старые вебхуки удалены');
}).catch(err => {
    console.log('❌ Ошибка удаления вебхуков:', err.message);
});

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['📱 Добавить телефон', '📋 Список'],
                ['❌ Удалить телефон', 'ℹ️ Помощь']
            ],
            resize_keyboard: true
        }
    };
    
    await bot.sendMessage(
        chatId,
        '👋 Привет! Я помогу отслеживать новые объявления на Kufar по всей Беларуси\n\n' +
        '📱 Нажми "Добавить телефон", чтобы начать',
        keyboard
    );
});

// Добавление телефона
bot.onText(/\/add|📱 Добавить телефон/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(
        chatId,
        '📱 Напиши название телефона:\nНапример: *iPhone 13*\n\nИскать буду по всей Беларуси',
        { parse_mode: 'Markdown' }
    );
    
    bot.once('message', async (response) => {
        if (response.text.startsWith('/')) return;
        
        const itemName = response.text.trim();
        
        trackedItems.push({
            id: Date.now().toString(),
            name: itemName,
            // ===== ИЗМЕНЕНО: теперь без /minsk/ = поиск по всей Беларуси =====
            url: `https://re.kufar.by/l/r?query=${encodeURIComponent(itemName)}`,
            dateAdded: new Date().toISOString()
        });
        
        saveTrackedItems();
        
        await bot.sendMessage(
            chatId,
            `✅ Теперь отслеживаю *${itemName}* по всей Беларуси`,
            { parse_mode: 'Markdown' }
        );
    });
});

// Список отслеживаемых
bot.onText(/\/list|📋 Список/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (trackedItems.length === 0) {
        await bot.sendMessage(chatId, '📭 Список пуст');
        return;
    }
    
    let message = '📋 *Список:*\n\n';
    trackedItems.forEach((item, index) => {
        message += `${index + 1}. *${item.name}*\n`;
    });
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Удаление телефона
bot.onText(/\/remove|❌ Удалить телефон/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (trackedItems.length === 0) {
        await bot.sendMessage(chatId, '📭 Нет телефонов');
        return;
    }
    
    let message = '❌ *Напиши номер:*\n\n';
    trackedItems.forEach((item, index) => {
        message += `${index + 1}. ${item.name}\n`;
    });
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
    bot.once('message', async (response) => {
        const num = parseInt(response.text);
        
        if (isNaN(num) || num < 1 || num > trackedItems.length) {
            await bot.sendMessage(chatId, '❌ Неправильный номер');
            return;
        }
        
        const removed = trackedItems.splice(num - 1, 1)[0];
        saveTrackedItems();
        
        await bot.sendMessage(chatId, `✅ Удалил: *${removed.name}*`, { parse_mode: 'Markdown' });
    });
});

// Помощь
bot.onText(/\/help|ℹ️ Помощь/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(
        chatId,
        'ℹ️ *Как пользоваться:*\n\n' +
        '1️⃣ Нажми "Добавить телефон"\n' +
        '2️⃣ Напиши название (например: iPhone 13)\n' +
        '3️⃣ Бот ищет по всей Беларуси\n' +
        '4️⃣ Жди уведомлений о новых объявлениях',
        { parse_mode: 'Markdown' }
    );
});

// Функция проверки Kufar
async function checkKufar() {
    if (trackedItems.length === 0) return;
    
    console.log('🔍 Проверка...', new Date().toLocaleString());
    
    let browser;
    try {
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        
        const page = await browser.newPage();
        
        for (const item of trackedItems) {
            try {
                await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 30000 });
                await page.waitForSelector('a[href*="/l/r/"]', { timeout: 10000 });
                
                const ads = await page.evaluate(() => {
                    const items = [];
                    const cards = document.querySelectorAll('a[href*="/l/r/"]');
                    
                    cards.forEach(card => {
                        try {
                            const id = card.href.split('/').pop() || Math.random().toString();
                            const titleEl = card.querySelector('h3, [class*="title"]');
                            const title = titleEl ? titleEl.textContent.trim() : '';
                            const priceEl = document.querySelector('[class*="price"]');
                            const price = priceEl ? priceEl.textContent.trim() : '';
                            
                            if (title) {
                                items.push({
                                    id: id,
                                    title: title,
                                    price: price,
                                    link: card.href
                                });
                            }
                        } catch (e) {}
                    });
                    
                    return items;
                });
                
                for (const ad of ads) {
                    if (!seenAds.has(ad.id)) {
                        const message = `
🆕 <b>НОВОЕ ОБЪЯВЛЕНИЕ!</b>
📱 <b>${item.name}</b>

<b>${ad.title}</b>
💰 ${ad.price}

🔗 <a href="${ad.link}">Открыть на Kufar</a>
                        `;
                        
                        await bot.sendMessage(YOUR_CHAT_ID, message, { parse_mode: 'HTML' });
                        seenAds.add(ad.id);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
                
            } catch (error) {
                console.log(`Ошибка при поиске ${item.name}:`, error.message);
            }
        }
        
        saveSeenAds();
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        if (browser) await browser.close();
    }
}

console.log('🚀 Бот запущен! Ищем по всей Беларуси');
bot.sendMessage(YOUR_CHAT_ID, '✅ Бот запущен! Теперь ищу по всей Беларуси\nНапиши /start');

setInterval(checkKufar, CHECK_INTERVAL);
setTimeout(checkKufar, 5000);
